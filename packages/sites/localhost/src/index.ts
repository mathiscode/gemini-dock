import bcrypt from 'bcryptjs'
import { and, desc, eq } from 'drizzle-orm'

import { CODES, respond } from '@gemini-dock/protocol'
import { comments, messages, notifications, posts, sessions, users } from '@gemini-dock/schema'
import type { SiteOptions } from '@gemini-dock/types'

const NOTIFICATION_DESCRIPTIONS = {
  comment: 'New Comment',
  message: 'New Message',
  like: 'New Like',
  follow: 'New Follow',
  mention: 'New Mention',
  post: 'New Post',
  postComment: 'New Post Comment',
}

const TEMP_SALTS: Record<string, string> = {}

export const routes = {
  // ROOT
  '/': async (options: SiteOptions) => {
    const { db } = options
    const last10Posts = await db.query.posts.findMany({ orderBy: [desc(posts.createdAt)], limit: 10, with: { user: true } })
    const last10Users = await db.query.users.findMany({ orderBy: [desc(users.createdAt)], limit: 10 })
    const last10Comments = await db.query.comments.findMany({ orderBy: [desc(comments.createdAt)], limit: 10, with: { user: true, post: { with: { user: true } } } })

    const postList = last10Posts.map(post => {
      let content = post.content?.substring(0, 100).split('\n').map(line => '> ' + line).join('\n')
      if (content && content.length > 100) content = content + '...'
      return `
        ## ${post.title}
        => /user/${post.user?.name} ${post.user?.emoji ? post.user?.emoji : '🤖'} ${post.user?.name}
        🗓️ ${post.createdAt}
        ${content}
        => /user/${post.user?.name}/posts/${post.slug} View post
      `.split('\n').map(line => line.trim()).join('\n  ')
    }).join('\n\n')

    const userList = last10Users.map(user => `
      => /user/${user.name} ${user.emoji ? user.emoji : '🤖'} ${user.name}
      🗓️ Joined ${user.createdAt}
    `.split('\n').map(line => line.trim()).join('\n  ')).join('\n\n')

    const commentList = last10Comments.map(comment => {
      let content = comment.content?.substring(0, 100).split('\n').map(line => '> ' + line).join('\n')
      if (content && content.length > 100) content = content + '...'
      return `
        ## ${comment.post?.title}
        => /user/${comment.post?.user?.name} ${comment.post?.user?.emoji ? comment.post?.user?.emoji : '🤖'} ${comment.post?.user?.name}
        => /user/${comment.user?.name} 🗨 ${comment.user?.emoji ? comment.user?.emoji : '🤖'} ${comment.user?.name}
        🗓️ ${comment.createdAt}
        ${content}
        => /user/${comment.post?.user?.name}/posts/${comment.post?.slug} View post
      `.split('\n').map(line => line.trim()).join('\n  ')
    }).join('\n\n')

    return respond(CODES.SUCCESS, `
      # 🚀 Gemini Dock

      This is a test site for Gemini Dock.
      It is currently ${new Date().toLocaleString()} on the server (${Intl.DateTimeFormat().resolvedOptions().timeZone}).

      => /dashboard 🎛️ Dashboard

      => gemini://gem.mathis.network

      # 📝 Last 10 Posts

      ${postList}

      # 🤖 Last 10 Signups

      ${userList}

      # 🗨 Last 10 Comments

      ${commentList}
    `)
  },

  // SIGNUP
  '/signup': async (options: SiteOptions) => {
    const { certificate, db, input, url } = options

    if (!certificate?.subject) return respond(CODES.CERTIFICATE_REQUIRED)

    let user = await db.query.users.findFirst({ where: eq(users.fingerprint, certificate.fingerprint256) })

    const step = url.pathname.split('/')[2]
    if (!step) return respond(CODES.REDIRECT_TEMPORARY, '/signup/name')

    switch (step) {
      case 'name':
        if (user) return respond(CODES.REDIRECT_PERMANENT, '/login')
        if (!input) return respond(CODES.REQUEST_INPUT, 'Please enter your username to signup')
        await db.insert(users).values({ site: url.hostname, name: input, fingerprint: certificate.fingerprint256, role: 'user' })
        return respond(CODES.REDIRECT_TEMPORARY, '/signup/email')
      case 'email':
        if (!input) return respond(CODES.REQUEST_INPUT, 'Please enter your email')
        await db.update(users).set({ email: input }).where(eq(users.fingerprint, certificate.fingerprint256))
        return respond(CODES.REDIRECT_TEMPORARY, '/signup/password')
      case 'password':
        if (!input) return respond(CODES.REQUEST_PASSWORD, 'Please enter your password')
        const salt = await bcrypt.genSalt(10)
        const hash = await bcrypt.hash(input, salt)
        await db.update(users).set({ password: hash }).where(eq(users.fingerprint, certificate.fingerprint256))
        return respond(CODES.REDIRECT_TEMPORARY, '/signup/confirm')
      case 'confirm':
        if (!input) return respond(CODES.REQUEST_PASSWORD, 'Please confirm your password')
        const confirmed = await bcrypt.compare(input, user?.password || '')
        if (!confirmed) return respond(CODES.FAIL_BAD_REQUEST, 'Password and confirmation do not match')
        return respond(CODES.REDIRECT_TEMPORARY, '/signup/complete')
      case 'complete':
        user = await db.query.users.findFirst({ where: eq(users.fingerprint, certificate.fingerprint256) })
        if (!user) return respond(CODES.FAIL_PERMANENT, 'User not found after signup? o_O')
        return respond(CODES.SUCCESS, `
          # 🎉 Signup complete

          Welcome ${user.name}

          You can now login.

          Your certificate and password are CRUCIAL - do not lose them!

          => /login Login
        `)
    }
  },

  // LOGIN
  '/login': async (options: SiteOptions) => {
    const { certificate, db, input } = options
    if (!certificate?.subject) return respond(CODES.CERTIFICATE_REQUIRED)

    const user = await db.query.users.findFirst({ where: eq(users.fingerprint, certificate.fingerprint256) })
    if (!user) return respond(CODES.REDIRECT_TEMPORARY, '/signup')

    const session = await db.query.sessions.findFirst({ where: eq(sessions.userId, user.id) })
    if (session) return respond(CODES.REDIRECT_PERMANENT, '/dashboard')

    if (!input) return respond(CODES.REQUEST_PASSWORD, `${user.name}, please enter your password to login`)
    const validPassword = await bcrypt.compare(input, user.password || '')
    if (!validPassword) return respond(CODES.FAIL_BAD_REQUEST, 'Invalid password')

    await db.update(users).set({ last_login: new Date().toISOString() }).where(eq(users.fingerprint, certificate.fingerprint256))
    await db.insert(sessions).values({ userId: user.id }).returning()
    return respond(CODES.REDIRECT_PERMANENT, '/dashboard')
  },

  // LOGOUT
  '/logout': async (options: SiteOptions) => {
    const { certificate, db } = options
    if (!certificate?.subject) return respond(CODES.CERTIFICATE_REQUIRED)

    const user = await db.query.users.findFirst({ where: eq(users.fingerprint, certificate.fingerprint256) })
    if (!user) return respond(CODES.REDIRECT_TEMPORARY, '/signup')

    await db.delete(sessions).where(eq(sessions.userId, user.id))
    return respond(CODES.REDIRECT_PERMANENT, '/')
  },

  // SETTINGS
  '/settings': async (options: SiteOptions) => {
    const { certificate, db, input, url } = options
    if (!certificate?.subject) return respond(CODES.CERTIFICATE_REQUIRED)

    const user = await db.query.users.findFirst({ where: eq(users.fingerprint, certificate.fingerprint256) })
    if (!user) return respond(CODES.REDIRECT_TEMPORARY, '/signup')

    const session = await db.query.sessions.findFirst({ where: eq(sessions.userId, user.id) })
    if (!session) return respond(CODES.REDIRECT_TEMPORARY, '/login')

    const metadata = JSON.parse(user.metadata || '{}')

    const command = url.pathname.split('/')[2]
    const subcommand = url.pathname.split('/')[3]
    if (!command) return respond(CODES.REDIRECT_PERMANENT, '/settings/profile')

    switch (command) {
      case 'profile':
        if (subcommand === 'name') {
          if (!input) return respond(CODES.REQUEST_INPUT, 'Please enter your new name')
          await db.update(users).set({ name: input }).where(eq(users.fingerprint, certificate.fingerprint256))
          return respond(CODES.REDIRECT_PERMANENT, '/settings/profile')
        }

        if (subcommand === 'emoji') {
          if (!input) return respond(CODES.REQUEST_INPUT, 'Please enter your new emoji')
          await db.update(users).set({ emoji: input }).where(eq(users.fingerprint, certificate.fingerprint256))
          return respond(CODES.REDIRECT_PERMANENT, '/settings/profile')
        }

        if (subcommand === 'bio') {
          if (!input) return respond(CODES.REQUEST_INPUT, 'Please enter your new bio')
          await db.update(users).set({ metadata: JSON.stringify({ ...metadata, bio: input }) }).where(eq(users.fingerprint, certificate.fingerprint256))
          return respond(CODES.REDIRECT_PERMANENT, '/settings/profile')
        }

        if (subcommand === 'link') {
          if (!input) return respond(CODES.REQUEST_INPUT, 'Please enter your new link')
          await db.update(users).set({ metadata: JSON.stringify({ ...metadata, link: input }) }).where(eq(users.fingerprint, certificate.fingerprint256))
          return respond(CODES.REDIRECT_PERMANENT, '/settings/profile/link-text')
        }

        if (subcommand == 'link-text') {
          if (!input) return respond(CODES.REQUEST_INPUT, 'Please enter your new link text')
          await db.update(users).set({ metadata: JSON.stringify({ ...metadata, linkText: input }) }).where(eq(users.fingerprint, certificate.fingerprint256))
          return respond(CODES.REDIRECT_PERMANENT, '/settings/profile')
        }
        
        if (subcommand === 'email') {
          if (!input) return respond(CODES.REQUEST_INPUT, 'Please enter your new email')
          await db.update(users).set({ email: input }).where(eq(users.fingerprint, certificate.fingerprint256))
          return respond(CODES.REDIRECT_PERMANENT, '/settings/profile')
        }
        
        if (subcommand === 'password') {
          if (!input) return respond(CODES.REQUEST_PASSWORD, 'Please enter your new password')
          const salt = await bcrypt.genSalt(10)
          const hash = await bcrypt.hash(input, salt)
          await db.update(users).set({ password: hash }).where(eq(users.fingerprint, certificate.fingerprint256))
          return respond(CODES.REDIRECT_PERMANENT, '/settings/profile/confirm-password')
        }

        if (subcommand === 'confirm-password') {
          if (!input) return respond(CODES.REQUEST_PASSWORD, 'Please confirm your new password')
          const confirmed = await bcrypt.compare(input, user.password || '')
          if (!confirmed) return respond(CODES.FAIL_BAD_REQUEST, 'Password and confirmation do not match')
          await db.update(users).set({ password: input }).where(eq(users.fingerprint, certificate.fingerprint256))
          return respond(CODES.REDIRECT_PERMANENT, '/settings/profile')
        }

        if (subcommand === 'email-public') {
          await db.update(users).set({ metadata: JSON.stringify({ ...metadata, emailPublic: !metadata.emailPublic }) }).where(eq(users.fingerprint, certificate.fingerprint256))
          return respond(CODES.REDIRECT_PERMANENT, '/settings/profile')
        }

        return respond(CODES.SUCCESS, `
          => /dashboard 🎛️ Dashboard
          # ${user.emoji ? user.emoji : '🤖'} ${user.name}

          => mailto:${user.email} ${user.email}${metadata.emailPublic ? ' (public)' : ''}
          ${metadata.link ? `=> ${metadata.link} ${metadata.linkText ? `${metadata.linkText}` : ''}` : ''}
          ${metadata.bio ? `${metadata.bio.split('\n').map((line: string) => '> ' + line).join('\n')}` : ''}
          
          ${`=> /settings/profile/email-public Make Email ${metadata.emailPublic ? 'Private' : 'Public'}`}
          => /settings/profile/name Edit Name
          => /settings/profile/emoji Edit Emoji
          => /settings/profile/bio Edit Bio
          => /settings/profile/link Edit Link
          => /settings/profile/email Edit Email
          => /settings/profile/password Edit Password
        `)
      default:
        return respond(CODES.FAIL_BAD_REQUEST, 'Invalid command')
    }
  },

  // DASHBOARD
  '/dashboard': async (options: SiteOptions) => {
    const { certificate, db } = options
    if (!certificate?.subject) return respond(CODES.CERTIFICATE_REQUIRED)

    const user = await db.query.users.findFirst({ where: eq(users.fingerprint, certificate.fingerprint256) })
    if (!user) return respond(CODES.REDIRECT_TEMPORARY, '/signup')

    const session = await db.query.sessions.findFirst({ where: eq(sessions.userId, user.id) })
    if (!session) return respond(CODES.REDIRECT_TEMPORARY, '/login')

    const notificationList = await db.query.notifications.findMany({
      where: eq(notifications.userId, user.id),
      orderBy: [desc(notifications.createdAt)]
    })

    return respond(CODES.SUCCESS, `
      # ${user.emoji ? user.emoji : '🤖'} ${user.name}
      => /user/${user.name} View profile
      => /settings/profile Edit Profile

      ## 🎛️ Dashboard

      => / 🏠 Home
      => /new 📝 Create Post
      => /posts 📚 Manage Posts
      => /messages 💬 Messages
      => /logout 🔑 Logout

      ## 🔔 Notifications

      ${notificationList.length === 0 ? 'No notifications' : `You have ${notificationList.length} notification${notificationList.length === 1 ? '' : 's'}.`}

      ${notificationList.length > 0 ? '=> /notifications/clear Clear All Notifications' : ''}

      ${notificationList.map(notification => `
        ### ${NOTIFICATION_DESCRIPTIONS[notification.type as keyof typeof NOTIFICATION_DESCRIPTIONS]}
        ${notification.content}

        ${notification.link ? `=> ${notification.link} ${notification.linkText ? `${notification.linkText}` : ''}` : ''}
        => /notifications/delete/${notification.id} Delete
      `.split('\n').map(line => line.trim()).join('\n  ')).join('\n\n')}
    `)
  },

  // NOTIFICATIONS
  '/notifications': async (options: SiteOptions) => {
    const { certificate, db, url } = options
    if (!certificate?.subject) return respond(CODES.CERTIFICATE_REQUIRED)

    const user = await db.query.users.findFirst({ where: eq(users.fingerprint, certificate.fingerprint256) })
    if (!user) return respond(CODES.REDIRECT_TEMPORARY, '/login')

    const session = await db.query.sessions.findFirst({ where: eq(sessions.userId, user.id) })
    if (!session) return respond(CODES.REDIRECT_TEMPORARY, '/login')

    const command = url.pathname.split('/')[2]
    if (!command) return respond(CODES.REDIRECT_PERMANENT, '/dashboard')

    switch (command) {
      case 'clear':
        await db.delete(notifications).where(eq(notifications.userId, user.id))
        return respond(CODES.REDIRECT_PERMANENT, '/dashboard')
      case 'delete':
        const notificationId = url.pathname.split('/')[3]
        if (!notificationId) return respond(CODES.REDIRECT_PERMANENT, '/dashboard')

        const notification = await db.query.notifications.findFirst({ where: eq(notifications.id, parseInt(notificationId)) })
        if (!notification) return respond(CODES.FAIL_NOT_FOUND, 'Notification not found')

        if (notification.userId !== user.id) return respond(CODES.FAIL_BAD_REQUEST, 'You are not allowed to delete this notification')

        await db.delete(notifications).where(eq(notifications.id, parseInt(notificationId)))
        return respond(CODES.REDIRECT_PERMANENT, '/dashboard')
      default:
        return respond(CODES.FAIL_BAD_REQUEST, 'Invalid command')
    }
  },

  // NEW POST
  '/new': async (options: SiteOptions) => {
    const { certificate, db, input, url } = options
    if (!certificate?.subject) return respond(CODES.CERTIFICATE_REQUIRED)

    const user = await db.query.users.findFirst({ where: eq(users.fingerprint, certificate.fingerprint256) })
    if (!user) return respond(CODES.REDIRECT_TEMPORARY, '/signup')

    const session = await db.query.sessions.findFirst({ where: eq(sessions.userId, user.id) })
    if (!session) return respond(CODES.REDIRECT_TEMPORARY, '/login')

    const metadata = JSON.parse(session.metadata || '{}')

    const step = url.pathname.split('/')[2]
    if (!step) return respond(CODES.REDIRECT_TEMPORARY, '/new/title')

    switch (step) {
      case 'title':
        if (!input) return respond(CODES.REQUEST_INPUT, 'Please enter the title of your post')
        await db.update(sessions).set({ metadata: JSON.stringify({ ...metadata, newPostTitle: input }) }).where(eq(sessions.id, session.id))
        return respond(CODES.REDIRECT_TEMPORARY, '/new/content')
      case 'content':
        if (!input) return respond(CODES.REQUEST_INPUT, 'Please enter the content of your post')
        let slug = metadata.newPostTitle.toLowerCase().replace(/[^a-z0-9-]/g, '-')
        const existingPost = await db.query.posts.findFirst({ where: eq(posts.slug, slug) })
        if (existingPost) slug = slug + '-' + Date.now()
        await db.insert(posts).values({ slug, userId: user.id, title: metadata.newPostTitle, content: input })
        return respond(CODES.REDIRECT_PERMANENT, '/posts')
    }
  },

  // POST
  '/post': async (options: SiteOptions) => {
    const { certificate, db, input, url } = options
    if (!certificate?.subject) return respond(CODES.CERTIFICATE_REQUIRED)

    const id = url.pathname.split('/')[2]
    if (!id) return respond(CODES.FAIL_BAD_REQUEST, 'Post ID is required')

    const post = await db.query.posts.findFirst({ where: eq(posts.id, parseInt(id))})
    if (!post) return respond(CODES.FAIL_NOT_FOUND, 'Post not found')

    const user = await db.query.users.findFirst({ where: eq(users.id, post.userId!) })
    if (!user) return respond(CODES.FAIL_NOT_FOUND, 'User not found')

    if (user.fingerprint !== certificate.fingerprint256) return respond(CODES.FAIL_BAD_REQUEST, 'You are not allowed to edit this post')
    const session = await db.query.sessions.findFirst({ where: eq(sessions.userId, user.id) })
    if (!session) return respond(CODES.REDIRECT_TEMPORARY, '/login')

    const command = url.pathname.split('/')[3]
    if (!command) return respond(CODES.FAIL_BAD_REQUEST, 'Command is required')

    switch (command) {
      case 'edit':
        if (!input) return respond(CODES.REQUEST_INPUT, 'Please enter the new title of your post')
        await db.update(posts).set({ title: input }).where(eq(posts.id, parseInt(id)))
        return respond(CODES.REDIRECT_PERMANENT, `/post/${id}/edit-content`)
      case 'edit-content':
        if (!input) return respond(CODES.REQUEST_INPUT, 'Please enter the new content of your post')
        await db.update(posts).set({ content: input }).where(eq(posts.id, parseInt(id)))
        return respond(CODES.REDIRECT_PERMANENT, '/posts')
      case 'delete':
        await db.delete(posts).where(eq(posts.id, parseInt(id)))
        return respond(CODES.REDIRECT_PERMANENT, '/posts')
    }
  },

  // MANAGE POSTS
  '/posts': async (options: SiteOptions) => {
    const { certificate, db } = options
    if (!certificate?.subject) return respond(CODES.CERTIFICATE_REQUIRED)

    const user = await db.query.users.findFirst({ where: eq(users.fingerprint, certificate.fingerprint256) })
    if (!user) return respond(CODES.REDIRECT_TEMPORARY, '/signup')

    const postList = await db.query.posts.findMany({ where: eq(posts.userId, user.id) })
    return respond(CODES.SUCCESS, `
      => /new 📝 Create ${postList.length === 0 ? 'your first' : 'another'} post
      => /dashboard 🎛️ Dashboard
      => /logout 🔑 Logout

      # 📝 Manage Posts

      ${postList.length === 0 ? 'No posts yet' : `You have ${postList.length} post${postList.length === 1 ? '' : 's'}.`}

      ${postList.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(post => {
        let content = post.content?.substring(0, 100).split('\n').map(line => '> ' + line).join('\n')
        if (content && content.length > 100) content = content + '...'
        return `
          ## ${post.title}
          🗓 ${post.createdAt}

          ${content}

          => /user/${user.name}/posts/${post.slug} 🔍 View
          => /post/${post.id}/edit 📝 Edit
          => /post/${post.id}/delete 🗑️ Delete

          ---
        `.split('\n').map(line => line.trim()).join('\n  ')
      }).join('\n\n')}
    `)
  },

  // USER
  '/user': async (options: SiteOptions) => {
    const { certificate, db, input, url, servername } = options

    const username = url.pathname.split('/')[2]
    if (!username) return respond(CODES.FAIL_BAD_REQUEST, 'Username is required')

    const author = await db.query.users.findFirst({ where: eq(users.name, username) })
    if (!author) return respond(CODES.FAIL_NOT_FOUND, 'User not found')

    const command = url.pathname.split('/')[3]
    const postSlug = url.pathname.split('/')[4]
    const subcommand = url.pathname.split('/')[5]
    const authorMetadata = JSON.parse(author.metadata || '{}')

    switch (command) {
      case 'feed':
        const postList = await db.query.posts.findMany({
          where: eq(posts.userId, author.id),
          orderBy: [desc(posts.createdAt)]
        })

        return respond(CODES.SUCCESS, `
          # 📰 ${author.name}'s Feed on ${servername}
          ## Total Posts: ${postList.length}

          ${postList.map(post => `
            => /user/${author.name}/posts/${post.slug} ${post.createdAt} - ${post.title}
          `.split('\n').map(line => line.trim()).join('\n  ')).join('\n\n')}
        `)
      case 'posts':
        if (postSlug) {
          let post
          switch (subcommand) {
            case 'comment':
              if (!certificate?.subject) return respond(CODES.CERTIFICATE_REQUIRED)

              const user = await db.query.users.findFirst({ where: eq(users.fingerprint, certificate.fingerprint256) })
              if (!user) return respond(CODES.REDIRECT_TEMPORARY, '/signup')

              const session = await db.query.sessions.findFirst({ where: eq(sessions.userId, user.id) })
              if (!session) return respond(CODES.REDIRECT_TEMPORARY, '/login')

              if (!input) return respond(CODES.REQUEST_INPUT, 'Please enter the comment')
              if (!postSlug) return respond(CODES.FAIL_BAD_REQUEST, 'Post slug is required')

              post = await db.query.posts.findFirst({ where: eq(posts.slug, postSlug) })
              if (!post) return respond(CODES.FAIL_NOT_FOUND, 'Post not found')

              await db.insert(comments).values({ postId: post.id, userId: user.id, content: input })
              await db.insert(notifications).values({
                userId: author.id,
                type: 'comment',
                content: `${user.name} commented on your post`,
                link: `/user/${author.name}/posts/${postSlug}`,
                linkText: 'View Post'
              })

              return respond(CODES.REDIRECT_PERMANENT, `/user/${author.name}/posts/${postSlug}`)
            default:
              post = await db.query.posts.findFirst({ where: eq(posts.slug, postSlug)})
              if (!post) return respond(CODES.FAIL_NOT_FOUND, 'Post not found')

              const commentList = await db.query.comments.findMany({
                where: eq(comments.postId, post.id),
                with: { user: true },
                orderBy: [desc(comments.createdAt)]
              })

              return respond(CODES.SUCCESS, `
                => / 🏠 Home
                => /dashboard 🎛️ Dashboard
                => /user/${author.name}/posts 📚 View all posts from ${author.name}
                => /user/${author.name}/feed 🔔 Subscribe to ${author.name}'s feed

                # ${post.title}
                ${post.createdAt}

                ${post.content?.split('\n').map(line => '> ' + line).join('\n')}

                ${commentList.length === 0 ? '## No comments yet' : `## ${commentList.length} comment${commentList.length === 1 ? '' : 's'}`}

                => /user/${author.name}/posts/${post.slug}/comment 🗨 Leave a Comment

                ${commentList.map(comment => `
                  ### ${comment.user?.name}
                  ${comment.createdAt}
                  ${comment.content?.split('\n').map(line => '> ' + line).join('\n')}
                `.split('\n').map(line => line.trim()).join('\n  ')).join('\n\n')}
              `)
          }
        } else {
          // GET POSTS
          const postList = await db.query.posts.findMany({
            where: eq(posts.userId, author.id),
            orderBy: [desc(posts.createdAt)],
            with: { comments: true }
          })

          const groupedPosts = postList
            .reduce((groups: Record<string, typeof postList>, post) => {
              const date = post.createdAt.split(' ')[0]
              if (!groups[date]) groups[date] = []
              groups[date].push(post)
              return groups
            }, {})
          
          return respond(CODES.SUCCESS, `
            => / 🏠 Home
            => /dashboard 🎛️ Dashboard
            
            # 🖹 ${author.name}'s Posts
            
            ${postList.length === 0 ? 'No posts yet' : `${author.name} has ${postList.length} post${postList.length === 1 ? '' : 's'}.`}
            
            => /user/${author.name}/feed 🔔 Subscribe to ${author.name}'s feed
            => /user/${author.name} ${author.emoji ? author.emoji : '🤖'} View profile

            ${Object.entries(groupedPosts).map(([date, posts]) => `
              # ${date}
              
              ${posts.map(post => {
                let content = post.content?.substring(0, 100).split('\n').map(line => '> ' + line).join('\n')
                if (content && content.length > 100) content = content + '...'
                return `
                  ## ${post.title}
                  => /user/${author.name}/posts/${post.slug} 🔍 View
                  🗓 ${post.createdAt.split(' ')[1]}
                  ${content}
                  ${post.comments.length === 0 ? 'No comments yet' : `${post.comments.length} comment${post.comments.length === 1 ? '' : 's'}`}
                `.split('\n').map(line => line.trim()).join('\n  ')
              }).join('\n\n')}
            `.split('\n').map(line => line.trim()).join('\n  ')).join('\n\n')}
          `)
        }
      default:
        return respond(CODES.SUCCESS, `
          # ${author.emoji ? author.emoji : '🤖'} ${author.name}
          ${authorMetadata.emailPublic ? `=> mailto:${author.email} ${author.email}` : ''}
          ${authorMetadata.link ? `=> ${authorMetadata.link} ${authorMetadata.linkText ? `${authorMetadata.linkText}` : ''}` : ''}
          ${authorMetadata.bio ? `${authorMetadata.bio.split('\n').map((line: string) => '> ' + line).join('\n')}` : ''}

          => /user/${author.name}/posts 📚 View all posts
          => /user/${author.name}/feed 🔔 Subscribe to feed
          => /messages/${author.name} 💬 Send a message
        `)
    }
  },

  // MESSAGES
  '/messages': async (options: SiteOptions) => {
    const { certificate, db, url, input } = options
    if (!certificate?.subject) return respond(CODES.CERTIFICATE_REQUIRED)

    const user = await db.query.users.findFirst({ where: eq(users.fingerprint, certificate.fingerprint256) })
    if (!user) return respond(CODES.REDIRECT_TEMPORARY, '/signup')

    const session = await db.query.sessions.findFirst({ where: eq(sessions.userId, user.id) })
    if (!session) return respond(CODES.REDIRECT_TEMPORARY, '/login')

    const metadata = JSON.parse(user.metadata || '{}')
    
    const command = url.pathname.split('/')[2]
    const subcommand = url.pathname.split('/')[3]
    if (!command) return respond(CODES.REDIRECT_PERMANENT, '/messages/inbox')

    switch (command) {
      case 'inbox':
        const messageList = await db.query.messages.findMany({
          where: eq(messages.to, user.id),
          orderBy: [desc(messages.createdAt)],
          with: { from: true }
        })

        return respond(CODES.SUCCESS, `
          => /dashboard 🎛️ Dashboard
          => /logout 🔑 Logout
          => /messages/new 🖆 New Message

          # ✉ Messages

          ${messageList.length === 0 ? 'No messages yet' : `You have ${messageList.length} message${messageList.length === 1 ? '' : 's'}.`}

          ${messageList.map(message => `
            ## ${message.from?.emoji ? message.from?.emoji : '🤖'} ${message.from?.name}
            => /messages/${message.id}/reply ✉ Reply
            => /messages/${message.id}/delete 🗑️ Delete
            🗓 ${message.createdAt}
            ${message.content?.substring(0, 100).split('\n').map(line => '> ' + line).join('\n')}
          `.split('\n').map(line => line.trim()).join('\n  ')).join('\n\n')}
        `)
      case 'delete':
        const deleteId = url.pathname.split('/')[3]
        if (!deleteId) return respond(CODES.FAIL_BAD_REQUEST, 'Message ID is required')
        await db.delete(messages).where(and(eq(messages.id, parseInt(deleteId)), eq(messages.to, user.id)))
        return respond(CODES.REDIRECT_PERMANENT, '/messages/inbox')
      case 'reply':
        const replyId = url.pathname.split('/')[3]
        if (!replyId) return respond(CODES.FAIL_BAD_REQUEST, 'Message ID is required')
        const message = await db.query.messages.findFirst({ where: eq(messages.id, parseInt(replyId)) })
        if (!message) return respond(CODES.FAIL_NOT_FOUND, 'Message not found')
        return respond(CODES.SUCCESS, `
          => /messages/inbox 📨 Inbox
          => /messages/new 🖆 New Message
        `)
      case 'new':
        if (!input) return respond(CODES.REQUEST_INPUT, 'Enter the username of the recipient')
        const exists = await db.query.users.findFirst({ where: eq(users.name, input) })
        if (!exists) return respond(CODES.FAIL_NOT_FOUND, 'Recipient not found')
        await db.update(users).set({ metadata: JSON.stringify({ ...metadata, messageRecipient: exists.id }) }).where(eq(users.id, user.id))
        return respond(CODES.REDIRECT_PERMANENT, '/messages/new-subject')
      case 'new-subject':
        const recipient = await db.query.users.findFirst({ where: eq(users.id, metadata.messageRecipient) })
        if (!recipient) return respond(CODES.FAIL_NOT_FOUND, 'Recipient not found')
        if (!input) return respond(CODES.REQUEST_INPUT, 'Enter the subject of the message')
        await db.update(users).set({ metadata: JSON.stringify({ ...metadata, messageSubject: input }) }).where(eq(users.id, user.id))
        return respond(CODES.REDIRECT_PERMANENT, '/messages/new-content')
      case 'new-content':
        const finalRecipient = await db.query.users.findFirst({ where: eq(users.id, metadata.messageRecipient) })
        if (!finalRecipient) return respond(CODES.FAIL_NOT_FOUND, 'Recipient not found')
        if (!input) return respond(CODES.REQUEST_INPUT, 'Enter the content of the message')
        await db.insert(messages).values({ from: user.id, to: finalRecipient.id, subject: metadata.messageSubject, content: input })
        return respond(CODES.REDIRECT_PERMANENT, '/messages/inbox')
      default:
        return respond(CODES.FAIL_BAD_REQUEST, 'Invalid command')
    }
  }
}

export default routes
