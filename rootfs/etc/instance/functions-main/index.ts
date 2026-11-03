// Main service of the Edge Runtime: /<function> → /opt/functions/<function>.
// The functions only get the values listed in PASS_ON (from this service's environment, see s6-rc.d/edge/run).
// No JWT check here: the functions check themselves (ersteinrichtung is allowed without login).
const FUNCTION = /^[a-z0-9-]{1,64}$/
const PASS_ON = ['SUPABASE_URL', 'SUPABASE_PUBLIC_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_DB_URL', 'MAX_AKTIVE_BENUTZER']
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
    return reply(String(e), 500)
  }
})
