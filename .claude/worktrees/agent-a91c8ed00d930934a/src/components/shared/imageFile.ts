export function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }

      reject(new Error('Nao foi possivel ler a imagem selecionada.'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('Falha a ler a imagem.'))
    reader.readAsDataURL(file)
  })
}
