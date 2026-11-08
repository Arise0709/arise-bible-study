/**
 * Grades a church-course quiz on the server, so a student can never write their own score.
 *
 * 1. As the student (their own sign-in), the database checks the enrollment, the version they are on, and the
 *    tries left (quiz_attempt_check). The same rules apply here as everywhere else.
 * 2. With the server key, the full version (with answers) is read and graded by the app's own grading code
 *    (src/lib/grading.ts), and the attempt and completion are recorded.
 * 3. Answers and explanations are returned only when the instructor chose to show them.
 *
 * Needs SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY (server only).
 */
import { clientId, rateLimited, sameSite } from './_lib/guard.js'
import { gradeQuiz } from '../src/lib/grading.js'
import type { Lesson, Quiz } from '../src/db/types.js'

const json = (status: number, body: unknown) => Response.json(body, { status })

export async function POST(request: Request) {
  const url = process.env.SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anon || !service) return json(501, { error: 'Church courses are not set up on this deployment.' })
  if (!sameSite(request)) return json(403, { error: 'This request must come from Carter Study Bible.' })
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return json(401, { error: 'Sign in first.' })
  if (await rateLimited(`org-quiz:${clientId(request)}`, 60, 20)) return json(429, { error: 'Too many submissions. Wait a minute and try again.' })
  let body: { course?: string; lesson?: string; answers?: Record<string, unknown> }
  try {
    body = await request.json()
  } catch {
    return json(400, { error: 'The request could not be read.' })
  }
  const answers = body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers) ? body.answers : {}
  if (JSON.stringify(answers).length > 100_000) return json(400, { error: 'Those answers are too long.' })

  // 1. as the student
  const chk = await fetch(`${url}/rest/v1/rpc/quiz_attempt_check`, {
    method: 'POST',
    headers: { apikey: anon, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ cid: body.course, lesson: body.lesson }),
  })
  const ctx = (await chk.json().catch(() => null)) as { enrollment_id: string; version: number; org_id: string; message?: string } | null
  if (!chk.ok || !ctx?.enrollment_id) {
    if (chk.status === 401) return json(401, { error: 'Your sign-in has expired. Sign in again.' })
    return json(chk.status === 403 ? 403 : 400, { error: ctx?.message && ctx.message.length < 300 ? ctx.message : 'This quiz cannot be submitted.' })
  }

  // 2. with the server key: the full version, graded by the shared grading code
  const admin = { apikey: service, authorization: `Bearer ${service}`, 'content-type': 'application/json' }
  const v = await fetch(`${url}/rest/v1/org_course_versions?course_id=eq.${encodeURIComponent(String(body.course))}&version=eq.${ctx.version}&select=content`, { headers: admin })
  const content = ((await v.json().catch(() => [])) as { content: { lessons: Lesson[] } }[])[0]?.content
  const lesson = content?.lessons.find((l) => l.id === body.lesson)
  const quiz = lesson?.quiz as Quiz | undefined
  if (!quiz) return json(400, { error: 'This lesson has no quiz.' })
  const known = new Set(quiz.questions.map((q) => q.id))
  const clean = Object.fromEntries(Object.entries(answers).filter(([k]) => known.has(k)))
  const g = gradeQuiz(quiz, clean)
  const ins = await fetch(`${url}/rest/v1/org_quiz_attempts`, {
    method: 'POST',
    headers: { ...admin, prefer: 'return=representation' },
    body: JSON.stringify({ org_id: ctx.org_id, course_id: body.course, enrollment_id: ctx.enrollment_id, lesson_id: body.lesson, quiz_id: quiz.id, version: ctx.version, answers: clean, score: g.score, passed: g.passed, results: g.results }),
  })
  if (!ins.ok) {
    console.log(JSON.stringify({ event: 'quiz_record_failed', status: ins.status }))
    return json(502, { error: 'Your answers could not be saved. Try again.' })
  }
  const row = ((await ins.json()) as { id: string; submitted_at: string }[])[0]
  await fetch(`${url}/rest/v1/rpc/refresh_completion`, { method: 'POST', headers: admin, body: JSON.stringify({ eid: ctx.enrollment_id }) })

  // 3. answers only as the instructor allowed
  const reveal = quiz.showAnswers === 'after-submit' || (quiz.showAnswers === 'after-pass' && g.passed)
  return json(200, { id: row.id, submitted_at: row.submitted_at, ...g, reveal, quiz: reveal ? quiz : undefined })
}
