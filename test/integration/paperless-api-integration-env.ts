/**
 * Env vars for paperless-ngx in Testcontainers. Used when compose's env_file
 * (docker-compose.env) is not available. Match deploy/compose/docker-compose.test.env.
 */
export const paperlessTestEnv = {
	PAPERLESS_SECRET_KEY: "test-secret-key-for-ephemeral-containers",
	PAPERLESS_ADMIN_USER: "admin",
	PAPERLESS_ADMIN_PASSWORD: "test-admin-password",
} as const;
