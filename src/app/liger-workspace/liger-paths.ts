/** LiGER answers with its working directory prefixed (`/…/liger/./grammars/…`). Sessions
 *  store the relative form, which resolves the same in every deployment. */
export function serverRelative(path: string): string {
  const cut = path.indexOf('/./');
  return cut >= 0 ? path.slice(cut + 1) : path;
}

/** Whether two spellings of a path (relative, prefixed, with or without `./`) name the same
 *  file. */
export function sameFile(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const norm = (p: string) => serverRelative(p).replace(/^\.\//, '');
  return norm(a) === norm(b);
}
