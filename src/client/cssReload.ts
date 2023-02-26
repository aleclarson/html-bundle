export default (file: string, cssText: string) => {
  const prevStyle = document.querySelector(
    `link[href="${file}"], style[data-href="${file}"]`
  )
  if (prevStyle) {
    const url = new URL(file, location.origin)
    console.log('[HMR] css changed:', url.href)
    const style = document.createElement('style')
    style.setAttribute('data-href', file)
    style.innerHTML = cssText
    prevStyle.after(style)
    prevStyle.remove()
  }
}
