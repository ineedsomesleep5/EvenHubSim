import { Chess } from 'chess.js'
import type { SubModuleFactory } from '../types'
import { appendEventLog } from '../../_shared/log'

const PIECE_CHARS: Record<string, string> = {
    p: '♟', r: '♜', n: '♞', b: '♝', q: '♛', k: '♚',
    P: '♙', R: '♖', N: '♘', B: '♗', Q: '♕', K: '♔',
}

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'] as const

type Phase = 'select' | 'target'

export const createChessModule: SubModuleFactory = (renderer, setStatus) => {
    const game = new Chess()
    let cursor = 0          // 0-63, index into board squares
    let phase: Phase = 'select'
    let fromSquare = ''
    let legalSquares: string[] = []

    const squareName = (idx: number) => `${FILES[idx % 8]}${RANKS[Math.floor(idx / 8)]}`

    const boardText = (): string => {
        const lines: string[] = []
        for (let rank = 0; rank < 8; rank++) {
            let row = `${8 - rank} `
            for (let file = 0; file < 8; file++) {
                const sq = squareName(rank * 8 + file)
                const piece = game.get(sq as 'a1')
                const ch = piece ? (PIECE_CHARS[piece.color === 'w' ? piece.type.toUpperCase() : piece.type] ?? piece.type) : '·'
                const isSelected = rank * 8 + file === cursor
                row += isSelected ? `[${ch}]` : ` ${ch} `
            }
            lines.push(row)
        }
        lines.push('  a  b  c  d  e  f  g  h')
        return lines.join('\n')
    }

    const statusLine = (): string => {
        if (game.isCheckmate()) return `Checkmate! ${game.turn() === 'w' ? 'Black' : 'White'} wins`
        if (game.isDraw()) return 'Draw!'
        if (game.isStalemate()) return 'Stalemate!'
        const turn = game.turn() === 'w' ? 'White' : 'Black'
        if (phase === 'select') return `${turn} to move — select piece`
        return `${turn}: ${fromSquare} → ? (select target)`
    }

    const renderBoard = async () => {
        await renderer.renderText(statusLine(), boardText())
    }

    const aiMove = async () => {
        if (game.isGameOver()) return
        const moves = game.moves()
        if (moves.length === 0) return
        const pick = moves[Math.floor(Math.random() * moves.length)]
        game.move(pick)
        appendEventLog(`Chess AI: ${pick}`)
        setStatus(`AI played ${pick}`)
        await renderBoard()
    }

    return {
        id: 'chess',
        label: 'Chess',
        async enter() {
            game.reset()
            cursor = 48 // e2 area — white pawns
            phase = 'select'
            fromSquare = ''
            legalSquares = []
            setStatus('Chess — you are White. Scroll to move cursor, click to select.')
            appendEventLog('Chess: new game')
            await renderBoard()
        },
        leave() {
            game.reset()
            cursor = 0
            phase = 'select'
        },
        async handleEvent(eventType) {
            if (eventType === 'double') return
            if (game.isGameOver()) {
                if (eventType === 'click') {
                    // restart
                    game.reset()
                    cursor = 48
                    phase = 'select'
                    setStatus('Chess — new game')
                    appendEventLog('Chess: restarted')
                }
                await renderBoard()
                return
            }

            if (eventType === 'up') {
                cursor = Math.max(0, cursor - 1)
                await renderBoard()
            } else if (eventType === 'down') {
                cursor = Math.min(63, cursor + 1)
                await renderBoard()
            } else if (eventType === 'click') {
                const sq = squareName(cursor)

                if (phase === 'select') {
                    // must click on own piece
                    const piece = game.get(sq as 'a1')
                    if (!piece || piece.color !== game.turn()) {
                        setStatus(`No ${game.turn() === 'w' ? 'white' : 'black'} piece on ${sq}`)
                        return
                    }
                    fromSquare = sq
                    const moves = game.moves({ square: sq as 'a1', verbose: true })
                    legalSquares = moves.map((m) => m.to)
                    if (legalSquares.length === 0) {
                        setStatus(`No legal moves from ${sq}`)
                        return
                    }
                    phase = 'target'
                    setStatus(`Selected ${sq} — pick target (${legalSquares.join(', ')})`)
                    appendEventLog(`Chess: selected ${sq}`)
                    await renderBoard()
                } else {
                    // target phase
                    if (legalSquares.includes(sq)) {
                        // Check if promotion needed (pawn reaching last rank)
                        const piece = game.get(fromSquare as 'a1')
                        const isPromo = piece?.type === 'p' && (sq[1] === '1' || sq[1] === '8')
                        game.move({ from: fromSquare as 'a1', to: sq as 'a1', promotion: isPromo ? 'q' : undefined })
                        appendEventLog(`Chess: ${fromSquare} → ${sq}`)
                        setStatus(`Played ${fromSquare}→${sq}. AI thinking...`)
                        phase = 'select'
                        fromSquare = ''
                        legalSquares = []
                        await renderBoard()
                        // AI move after short delay
                        setTimeout(() => void aiMove(), 500)
                    } else {
                        // Clicked non-target — cancel selection
                        phase = 'select'
                        fromSquare = ''
                        legalSquares = []
                        setStatus('Selection cancelled — pick a piece')
                        await renderBoard()
                    }
                }
            }
        },
    }
}
