import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).end()
  }

  const { email } = req.body ?? {}

  try {
    await fetch('https://subscribe-forms.beehiiv.com/12f31451-3ac2-4d22-909b-ff74edaee332', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email }),
    })
  } catch (_) {
    // Silently continue
  }

  return res.status(200).end()
}
