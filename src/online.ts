import type { MatchState, ReplayFrame } from './duel'

export type Replay = {
  seat: number
  angle: number
  before: MatchState
  frames: ReplayFrame[]
}

export type Match = {
  id: string
  seat: number
  version: number
  ready: boolean
  state: MatchState
  replay: Replay | null
}

type Entry = { token: string; match: Match }

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch('/api/matches' + path, {
    ...options,
    signal: AbortSignal.timeout(10000),
  })
  if (response.status === 204) return null as T
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.error ?? 'Сервер недоступен')
  }
  return response.json()
}

export const createMatch = () => request<Entry>('', { method: 'POST' })
export const joinMatch = (id: string) => request<Entry>('/' + id + '/join', { method: 'POST' })
const authorization = (token: string) => ({ Authorization: 'Bearer ' + token })
export const getMatch = (id: string, token: string, since?: number) =>
  request<Match | null>('/' + id + (since === undefined ? '' : '?since=' + since), {
    headers: authorization(token),
  })

export const submitShot = (match: Match, token: string, angle: number, power: number) =>
  request<Match>('/' + match.id + '/shot', {
    method: 'POST',
    headers: { ...authorization(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: match.version, angle, power }),
  })

export function sessionValue(key: string, value?: string) {
  try {
    if (value === undefined) return localStorage.getItem(key)
    localStorage.setItem(key, value)
  } catch {
    // The active tab still works when the browser blocks storage.
  }
  return null
}
