/**
 * Append a timestamped entry to the #event-log element.
 */
export function appendEventLog(message: string): void {
    const container = document.getElementById('event-log')
    if (!container) return

    // Remove the "no events" placeholder
    const placeholder = container.querySelector('.event-log__empty')
    if (placeholder) placeholder.remove()

    const now = new Date()
    const time = now.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    })

    const entry = document.createElement('div')
    entry.className = 'event-log__entry'
    entry.innerHTML = `<span class="event-log__time">${time}</span>${escapeHtml(message)}`

    container.appendChild(entry)
    container.scrollTop = container.scrollHeight
}

function escapeHtml(str: string): string {
    const div = document.createElement('div')
    div.textContent = str
    return div.innerHTML
}
