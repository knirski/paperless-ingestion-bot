/**
 * Paperless-ngx domain types.
 */

import { Schema } from "effect";

/**
 * Branded type for tag name (normalized, lowercase).
 * Used as Map key in the in-memory tag cache.
 */
export const TagNameSchema = Schema.String.pipe(Schema.brand("TagName"));
export type TagName = Schema.Schema.Type<typeof TagNameSchema>;

/** Create a TagName from a string (lowercase for case-insensitive lookup). */
export function toTagName(name: string): TagName {
	return name.toLowerCase() as TagName;
}

/**
 * Branded type for Paperless tag ID (from API).
 * Used as Map value in the in-memory tag cache.
 */
export const TagIdSchema = Schema.Number.pipe(Schema.brand("TagId"));
export type TagId = Schema.Schema.Type<typeof TagIdSchema>;
