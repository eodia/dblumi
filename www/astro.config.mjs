// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	site: 'https://eodia.github.io',
	base: '/dblumi',
	integrations: [
		starlight({
			title: 'dblumi',
			logo: {
				src: './public/logo-dblumi.svg',
				replacesTitle: true,
			},
			description: 'The modern SQL client with AI, built for developers',
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/eodia/dblumi' },
				{ icon: 'discord', label: 'Discord', href: 'https://discord.gg/dblumi' },
			],
			customCss: ['./src/styles/starlight-custom.css'],
			locales: {
				root: { label: 'English', lang: 'en' },
				fr: { label: 'Français', lang: 'fr' },
			},
			sidebar: [
				{
					label: 'Getting Started',
					translations: { fr: 'Pour commencer' },
					items: [
						{ label: 'Introduction', slug: 'guides/introduction', translations: { fr: 'Introduction' } },
						{ label: 'Installation', slug: 'guides/installation', translations: { fr: 'Installation' } },
						{ label: 'First connection', slug: 'guides/first-connection', translations: { fr: 'Premiere connexion' } },
					],
				},
				{
					label: 'Features',
					translations: { fr: 'Fonctionnalites' },
					items: [
						{ label: 'SQL Editor', slug: 'features/sql-editor', translations: { fr: 'Editeur SQL' } },
						{ label: 'AI Copilot', slug: 'features/ai-copilot', translations: { fr: 'Copilot IA' } },
						{ label: 'Saved Queries', slug: 'features/saved-queries', translations: { fr: 'Requetes sauvegardees' } },
						{ label: 'Schema & ERD', slug: 'features/schema-erd', translations: { fr: 'Schema & ERD' } },
						{ label: 'Security & Guardrails', slug: 'features/security', translations: { fr: 'Securite & Garde-fous' } },
						{ label: 'REST API & Swagger', slug: 'features/rest-api', translations: { fr: 'API REST & Swagger' } },
					],
				},
				{
					label: 'Self-hosting',
					translations: { fr: 'Hebergement' },
					items: [
						{ label: 'Configuration', slug: 'self-hosting/configuration', translations: { fr: 'Configuration' } },
						{ label: 'Auth & SSO', slug: 'self-hosting/auth-sso', translations: { fr: 'Auth & SSO' } },
						{ label: 'Environment variables', slug: 'self-hosting/environment-variables', translations: { fr: 'Variables d\'environnement' } },
					],
				},
				{
					label: 'Administration',
					translations: { fr: 'Administration' },
					items: [
						{ label: 'User management', slug: 'admin/users', translations: { fr: 'Gestion des utilisateurs' } },
						{ label: 'Groups & permissions', slug: 'admin/groups', translations: { fr: 'Groupes & permissions' } },
					],
				},
			],
		}),
	],
});
