// Main service of the Edge Runtime: /<function> → /opt/functions/<function>.
// The functions only get the values listed in PASS_ON (from this service's environment, see s6-rc.d/edge/run).
// No JWT check here: the functions check themselves (ersteinrichtung is allowed without login).
const FUNCTION = /^[a-z0-9-]{1,64}$/
const PASS_ON = ['SUPABASE_URL', 'SUPABASE_PUBLIC_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_DB_URL', 'MAX_AKTIVE_BENUTZER',
  // Mail (app 2.92+, supabase/functions/_shared/mail.ts)
  'MAIL_SCHLUESSEL', 'MAIL_ZENTRAL_HOST', 'MAIL_ZENTRAL_PORT', 'MAIL_ZENTRAL_SICHERHEIT', 'MAIL_ZENTRAL_BENUTZER', 'MAIL_ZENTRAL_PASSWORT',
  'MAIL_ZENTRAL_ABSENDER', 'MAIL_INTERNE_ZIELE']
const env = PASS_ON.flatMap((k) => (Deno.env.get(k) ? [[k, Deno.env.get(k)!]] : []))

function reply(msg: string, status: number) {
  return new Response(JSON.stringify({ msg }), { status, headers: { 'Content-Type': 'application/json' } })
}

Deno.serve(async (req: Request) => {
  const name = new URL(req.url).pathname.split('/')[1] ?? ''
  if (!FUNCTION.test(name) || name === 'main') return reply('function missing', 400)
  try {
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath: `/opt/functions/${name}`,
      memoryLimitMb: 150,
      workerTimeoutMs: 60 * 1000,
      noModuleCache: false,
      importMapPath: null,
      envVars: env,
    })
    return await worker.fetch(req)
  } catch (e) {
    // Details only in the container log, not to the browser (paths, stack trace)
    console.error(`function ${name}:`, e)
    return reply('function unavailable', 500)
  }
})
