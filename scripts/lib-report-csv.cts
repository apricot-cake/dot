// 人が Excel で読むレポート。CSV 構文の引用と数式評価の抑止を別々に行う。
function quoteCell(value: unknown): string {
  let text = String(value ?? '');
  // biome-ignore lint/suspicious/noControlCharactersInRegex: CSV readers may skip leading control characters before formula recognition.
  if (/^[\s\u0000-\u001f\u007f]*[=+\-@＝＋－＠]/u.test(text) || /^[\t\r\n]/u.test(text)) text = '\t' + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

function reportCsv(rows: unknown[][]): string {
  return '\uFEFF' + rows.map((row) => row.map(quoteCell).join(',')).join('\r\n');
}
module.exports = { quoteCell, reportCsv };
