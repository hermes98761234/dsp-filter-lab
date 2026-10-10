/** Marks a string for translation where it is defined away from its t() call. */
export const N = (s: string) => s

/** A translatable message: English source string followed by its {0}, {1} ... arguments. */
export type Note = [string, ...(string | number)[]]
