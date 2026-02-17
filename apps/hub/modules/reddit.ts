import type { SubModuleFactory } from '../types'
import { appendEventLog } from '../../_shared/log'
import { redditFetch } from '../../_shared/proxy'

type Post = { title: string; score: number; subreddit: string; selftext: string; num_comments: number }

export const createRedditModule: SubModuleFactory = (renderer, setStatus) => {
    let posts: Post[] = []
    let selected = 0
    let viewing = false   // true = reading a post body, false = browsing list

    const fetchPosts = async () => {
        setStatus('Reddit: fetching posts...')
        appendEventLog('Reddit: fetching /r/popular')
        try {
            const res = await redditFetch('/r/popular/.json?limit=20')
            if (!res.ok) {
                appendEventLog(`Reddit: error status ${res.status}`)
                throw new Error(`HTTP ${res.status}`)
            }
            const json = await res.json() as { data: { children: { data: Post }[] } }
            posts = json.data.children.map((c) => c.data)
            selected = 0
            viewing = false
            setStatus(`Reddit: ${posts.length} posts loaded — scroll to browse`)
            appendEventLog(`Reddit: loaded ${posts.length} posts`)
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            setStatus(`Reddit: failed — ${msg}`)
            appendEventLog(`Reddit: error — ${msg}`)
        }
    }

    const showList = async () => {
        if (posts.length === 0) {
            await renderer.renderText('Reddit', 'No posts loaded')
            return
        }
        const items = posts.map((p, i) => {
            const prefix = `${p.score}↑`
            const title = p.title.length > 40 ? p.title.slice(0, 37) + '...' : p.title
            return `${prefix} ${title}`
        })
        await renderer.renderList('Reddit — r/popular', items, selected)
    }

    const showPost = async () => {
        const p = posts[selected]
        if (!p) return
        const body = p.selftext
            ? (p.selftext.length > 200 ? p.selftext.slice(0, 197) + '...' : p.selftext)
            : '(link post — no text)'
        await renderer.renderText(
            p.title.slice(0, 50),
            `r/${p.subreddit} · ${p.score}↑ · ${p.num_comments} comments\n${body}`
        )
    }

    return {
        id: 'reddit',
        label: 'Reddit',
        async enter() {
            await fetchPosts()
            await showList()
        },
        leave() { posts = []; selected = 0; viewing = false },
        async handleEvent(eventType) {
            if (eventType === 'double') {
                if (viewing) {
                    // Back to list
                    viewing = false
                    await showList()
                    return
                }
                return // hub handles double-click to go to menu
            }
            if (viewing) {
                // While viewing a post, click goes back to list
                if (eventType === 'click') {
                    viewing = false
                    await showList()
                }
                return
            }
            // Browsing list
            if (eventType === 'up') {
                selected = Math.max(0, selected - 1)
                await showList()
            } else if (eventType === 'down') {
                selected = Math.min(posts.length - 1, selected + 1)
                await showList()
            } else if (eventType === 'click') {
                viewing = true
                await showPost()
                setStatus(`Reddit: viewing "${posts[selected]?.title.slice(0, 40)}"`)
            }
        },
    }
}
