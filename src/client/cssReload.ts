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
  }
}
