/**
 * Quiz grading, shared by the app (personal courses) and the server (church courses, api/org-quiz.ts), so there is
 * one grading engine. Pure: no browser storage, no network.
 */
import type { Question, Quiz } from '../db/types.js'
import { parseOsis, parseRef, toOsis } from './refs.js'

export const isAutoGraded = (q: Question) => q.type !== 'short' && q.type !== 'reflection'

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

export interface QuestionResult {
  id: string
  auto: boolean
  credit: number // 0 to 1 for auto-graded questions
  answered: boolean
}

export function gradeQuestion(q: Question, given: unknown): QuestionResult {
  const auto = isAutoGraded(q)
  const answered = given !== undefined && given !== null && given !== '' && !(Array.isArray(given) && !given.length)
  let credit = 0
  if (auto && answered) {
    switch (q.type) {
      case 'choice':
        credit = given === q.answer ? 1 : 0
        break
      case 'truefalse':
        credit = given === q.answer ? 1 : 0
        break
      case 'blank':
        credit = (q.answer as string[]).some((a) => norm(a) === norm(String(given))) ? 1 : 0
        break
      case 'reference': {
        const r = parseRef(String(given))
        const want = parseOsis(String(q.answer))
        credit = r && want && toOsis(r) === toOsis(want) ? 1 : 0
        break
      }
      case 'matching': {
        const pairs = q.pairs ?? []
        const g = given as Record<string, string>
        const right = pairs.filter(([a, b], i) => g?.[String(i)] === b || g?.[a] === b).length
        credit = pairs.length ? right / pairs.length : 0
        break
      }
    }
  }
  return { id: q.id, auto, credit, answered }
}

export interface QuizResult {
  score: number // percent of auto-graded points; 100 when nothing is auto-graded
  passed: boolean
  results: QuestionResult[]
  /** Scripture to revisit: references of questions not fully correct */
  review: string[]
  written: number
}

export function gradeQuiz(quiz: Quiz, answers: Record<string, unknown>): QuizResult {
  const results = quiz.questions.map((q) => gradeQuestion(q, answers[q.id]))
  const auto = results.filter((r) => r.auto)
  const score = auto.length ? Math.round((auto.reduce((a, r) => a + r.credit, 0) / auto.length) * 100) : 100
  const review = [...new Set(quiz.questions.filter((_, i) => results[i].auto && results[i].credit < 1).flatMap((q) => q.refs))]
  return { score, passed: score >= quiz.passScore, results, review, written: results.filter((r) => !r.auto).length }
}

