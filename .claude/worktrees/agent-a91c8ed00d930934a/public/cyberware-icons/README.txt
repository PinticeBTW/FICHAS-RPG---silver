Mete os icones das cyberwares aqui.

Como funciona:
- O ficheiro usado vem do campo `icon` em `src/data/cyberwares.ts`
- Se `icon: 'kikishi-eyes'`, o sistema tenta:
  - `/cyberware-icons/kikishi-eyes.png`
  - `/cyberware-icons/kikishi-eyes.webp`
  - `/cyberware-icons/kikishi-eyes.jpg`
  - `/cyberware-icons/kikishi-eyes.jpeg`
  - `/cyberware-icons/kikishi-eyes.svg`

Podes reutilizar o mesmo icon em varias cyberwares:
- basta meter o mesmo valor no campo `icon`

Exemplo:
- `icon: 'optic-basic'`
- ficheiro: `public/cyberware-icons/optic-basic.png`
