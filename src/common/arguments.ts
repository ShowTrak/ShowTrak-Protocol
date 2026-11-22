// A script's argument string, split into argv.
//
// A ShowTrak script's configuration carries its command-line arguments per
// platform as one string ("--name 'Main Stage' -v"). ShowTrak Client splits it
// when it runs a script it was sent, and ShowTrak Server when it runs one on
// its own machine (Scripts:RunLocalFile). Both must split the same string the
// same way, or a script behaves differently depending on where it runs.

/**
 * Split a shell-style argument string into argv tokens.
 *
 * Whitespace separates tokens. Single and double quotes group (and are
 * removed), a backslash takes the next character literally, and a trailing
 * lone backslash is kept. Nothing is expanded: no variables, globs or
 * substitutions. Anything that is not a non-empty string gives no arguments.
 */
export function ParseArgumentString(value: unknown): string[] {
  const input = String(value || '').trim();
  if (!input) return [];

  const args: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let escaping = false;

  const pushCurrent = () => {
    if (current.length > 0) {
      args.push(current);
      current = '';
    }
  };

  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charAt(i);

    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }
    if (ch === '\\') {
      escaping = true;
      continue;
    }

    if (inSingle) {
      if (ch === "'") inSingle = false;
      else current += ch;
      continue;
    }

    if (inDouble) {
      if (ch === '"') inDouble = false;
      else current += ch;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }

    if (/\s/.test(ch)) {
      pushCurrent();
      continue;
    }

    current += ch;
  }

  if (escaping) current += '\\';
  pushCurrent();
  return args;
}
