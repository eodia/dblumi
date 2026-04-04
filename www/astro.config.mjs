// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	site: 'https://dblumi.eodia.com',
	integrations: [
		starlight({
			title: 'dblumi',
			description: 'The modern SQL client with AI, built for developers',
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/marcjamain/dblumi' }],
			sidebar: [
				{
					label: 'Getting Started',
					items: [
						{ label: 'Introduction', slug: 'guides/introduction' },
						{ label: 'Installation', slug: 'guides/installation' },
						{ label: 'First connection', slug: 'guides/first-connection' },
					],
				},
				{
					label: 'Features',
					items: [
						{ label: 'SQL Editor', slug: 'features/sql-editor' },
						{ label: 'AI Copilot', slug: 'features/ai-copilot' },
						{ label: 'Saved Queries', slug: 'features/saved-queries' },
						{ label: 'Schema & ERD', slug: 'features/schema-erd' },
						{ label: 'Security & Guardrails', slug: 'features/security' },
					],
				},
				{
					label: 'Self-hosting',
					items: [
						{ label: 'Configuration', slug: 'self-hosting/configuration' },
						{ label: 'Auth & SSO', slug: 'self-hosting/auth-sso' },
						{ label: 'Environment variables', slug: 'self-hosting/environment-variables' },
					],
				},
				{
					label: 'Administration',
					items: [
						{ label: 'User management', slug: 'admin/users' },
						{ label: 'Groups & permissions', slug: 'admin/groups' },
					],
				},
			],
		}),
	],
});
