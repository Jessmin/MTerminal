export function join(directory, name, side = 'remote') {
  const windows = side === 'local' && (/^[a-z]:/i.test(directory) || /^[\\/]{2}/.test(directory));
  return windows ? directory.replace(/[\\/]+$/, '') + '\\' + name : directory.replace(/\/$/, '') + '/' + name;
}
export function parent(directory, side = 'remote') {
  if (side === 'local' && (/^[a-z]:/i.test(directory) || /^[\\/]{2}/.test(directory))) {
    const value = directory.replace(/\//g, '\\');
    const drive = value.match(/^([a-z]:)(?:\\|$)/i);
    const share = value.match(/^(\\\\[^\\]+\\[^\\]+)(?:\\|$)/);
    const root = drive ? drive[1] + '\\' : share ? share[1] + '\\' : '\\';
    const trimmed = value.replace(/\\+$/, '');
    const index = trimmed.lastIndexOf('\\');
    return index < root.length ? root : trimmed.slice(0, index);
  }
  return directory.replace(/\/+$/, '').replace(/\/[^/]*$/, '') || '/';
}
