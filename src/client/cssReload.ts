export default async (file: string) => {
  const url = new URL(file, import.meta.env.DEV_URL)

  const prevLink = document.querySelector(`link[href^="${url.href}"]`)
  if (prevLink) {
    console.log('[HMR] css updated:', url.href)
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = url.href + '?t=' + Date.now()
    link.onload = () => prevLink.remove()
    prevLink.after(link)
  } else {
    const style = document.querySelector(`style[data-href^="${url.href}"]`)
    if (style) {
      console.log('[HMR] css updated:', url.href)
      style.textContent = await fetch(url.href, { cache: 'no-store' }).then(
        res => res.text()
      )
    }
  }
}
