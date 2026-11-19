const STUB = new URL('./base-stub.mjs', import.meta.url).href;
export async function resolve(specifier, context, next) {
  if (specifier === '@companion-module/base') return { url: STUB, shortCircuit: true };
  return next(specifier, context);
}
