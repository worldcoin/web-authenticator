import { test } from 'node:test'
import assert from 'node:assert/strict'
import { requestIp } from '../src/lib/request-ip'
import { loadDemoProfile, saveDemoProfile, type DemoProfile } from '../src/lib/demo-profile'

const profile: DemoProfile = {
	version: 1,
	passkey: { credentialId: 'aGVsbG8', prfSupported: true },
	registration: 'created',
}

test('persists only public metadata and resumes the same passkey', () => {
	let saved = ''
	saveDemoProfile(
		{
			setItem: (_key, value) => {
				saved = value
			},
		},
		{ ...profile, seed: 'secret', databaseKey: 'secret' } as DemoProfile
	)
	assert.ok(!saved.includes('secret'))
	assert.deepEqual(loadDemoProfile({ getItem: () => saved }), profile)
})

test('preserves uncertain submission state and rejects malformed profiles without overwriting them', () => {
	assert.equal(
		loadDemoProfile({ getItem: () => JSON.stringify({ ...profile, registration: 'submitting' }) })?.registration,
		'submitting'
	)
	assert.throws(() => loadDemoProfile({ getItem: () => '{invalid' }), /preserved/)
	assert.throws(
		() => loadDemoProfile({ getItem: () => JSON.stringify({ ...profile, registration: 'finalized' }) }),
		/preserved/
	)
	assert.throws(
		() =>
			saveDemoProfile(
				{
					setItem: () => {
						throw new Error('Quota exceeded')
					},
				},
				profile
			),
		/Could not save/
	)
})

test('IP headers are validated, bounded, and explicitly unverified', () => {
	assert.deepEqual(requestIp(new Headers({ 'x-forwarded-for': '203.0.113.1, 10.0.0.1' })), {
		ip: '203.0.113.1',
		source: 'x-forwarded-for',
		verified: false,
	})
	assert.equal(requestIp(new Headers({ 'x-forwarded-for': 'untrusted text', 'x-real-ip': '::1' })).ip, '::1')
	assert.equal(requestIp(new Headers({ 'x-forwarded-for': 'a'.repeat(1025) })).ip, null)
	assert.equal(requestIp(new Headers()).source, 'unavailable')
})
