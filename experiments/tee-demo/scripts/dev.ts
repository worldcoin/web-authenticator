export {}

const apiPort = process.env.API_PORT || '3101'
const api = Bun.spawn([process.execPath, '--watch', 'src/server/index.ts'], {
	env: { ...process.env, PORT: apiPort, NODE_ENV: 'development', LOCAL_TEE_DEMO_ADMISSION: '1' },
	stdout: 'inherit',
	stderr: 'inherit',
})
const web = Bun.spawn([process.execPath, 'node_modules/vite/bin/vite.js', ...process.argv.slice(2)], {
	env: { ...process.env, API_PORT: apiPort },
	stdout: 'inherit',
	stderr: 'inherit',
})
const stop = () => {
	api.kill()
	web.kill()
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, stop)
const exitCode = await Promise.race([api.exited, web.exited])
stop()
await Promise.all([api.exited, web.exited])
process.exit(exitCode)
