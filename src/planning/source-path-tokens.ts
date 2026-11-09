/** 只扫描完整路径 token，避免从长 token 的每个后缀反复尝试文件名匹配。 */
export function sourcePathTokens(text: string): string[] {
  return (text.match(/[A-Za-z0-9_$@./-]+/gu) ?? []).flatMap(token => {
    const path = sourcePathToken(token)
    return path === undefined ? [] : [path]
  })
}

/** 从提示文本中移除文件路径，保留相邻业务描述与声明名称。 */
export function stripSourcePathTokens(text: string): string {
  return text.replace(/[A-Za-z0-9_$@./-]+/gu, (token) => sourcePathToken(token) === undefined ? token : ' ')
}

/** 扩展名必须位于 token 末尾；本函数只识别路径，不授权读写或解析父目录。 */
function sourcePathToken(token: string): string | undefined {
  // 英文句末句点不属于路径；只在 token 末尾移除，保留扩展名与父目录字符。
  let end = token.length
  while (end > 0 && token[end - 1] === '.') end--
  const path = token.slice(0, end)
  return /\.(?:[cm]?[jt]sx?|json|md|ya?ml)$/u.test(path) ? path : undefined
}
