import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeHistoryDocument, encodeHistoryDocument, historyPlainText, safeHistoryLink } from '../../src/lib/historyDocument.ts'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import { TaskItem, TaskList } from '@tiptap/extension-list'

test('legacy Markdown becomes visual content without dropping unknown syntax or fetching images',()=>{
  const body='# Memórias\n\n**Forte** e *leve* <b>literal</b>.\n\n- Um\n- Dois\n\n![antiga](https://example.test/old.png)\n\n[perigo](javascript:alert(1))\n\n[referência]: https://example.test/ref'
  const doc=decodeHistoryDocument(body), saved=encodeHistoryDocument(doc)
  const plain=historyPlainText(saved)
  for(const value of ['Memórias','Forte','leve','<b>literal</b>','Um','Dois','![antiga]','javascript:alert(1)','[referência]:'])assert.ok(plain.includes(value),value)
  assert.equal(doc.content[0].type,'heading')
  assert.ok(!saved.includes('"type":"image"'))
  assert.deepEqual(decodeHistoryDocument(saved),doc)
})
test('tables, boxes and nested checklists round-trip with safe attributes',()=>{
  const p={type:'paragraph',content:[{type:'text',text:'Memória'}]}
  const doc={type:'doc',content:[{type:'blockquote',content:[p]},{type:'taskList',content:[{type:'taskItem',attrs:{checked:true},content:[p]}]}, {type:'table',content:[{type:'tableRow',content:[{type:'tableCell',attrs:{colspan:1,rowspan:1,onclick:'evil'},content:[p]}]}]}]}
  const saved=encodeHistoryDocument(doc)
  assert.ok(!saved.includes('onclick'))
  assert.equal(decodeHistoryDocument(saved).content[1].content[0].attrs.checked,true)
  assert.ok(historyPlainText(saved).includes('Memória'))
})
test('malformed/future documents, dangerous links, unsupported nodes and oversize text fail closed',()=>{
  for(const body of ['ghostgrid:history-document:v9\n{}','ghostgrid:history-document:v1\n{"type":"doc","content":[{"type":"image"}]}','ghostgrid:history-document:v1\nnot json','ghostgrid:history-document:v1\n{"type":"doc","content":[{"type":"text","text":"lost"}]}'])assert.throws(()=>decodeHistoryDocument(body))
  for(const href of ['javascript:alert(1)','data:text/html,evil','file:///secret','https:\n//example.test'])assert.equal(safeHistoryLink(href),false)
  assert.throws(()=>encodeHistoryDocument({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'x'.repeat(500000)}]}]}),/limite/)
})
test('imported legacy structures validate in the real editor schema without losing their text',()=>{
  const schema=getSchema([StarterKit.configure({trailingNode:false}),TableKit,TaskList,TaskItem])
  for(const body of ['- # Título numa lista\n\n  Mais texto', '<b>HTML antigo</b>\n\nTexto [ligação](https://example.test) com **negrito** e ![imagem](https://example.test/test.png)', '> Caixa antiga\n>\n> - Memória\n> - Outra memória', '```js\nconst a = 1\n```']){
    const doc=decodeHistoryDocument(body),node=schema.nodeFromJSON(doc)
    node.check()
    assert.equal(historyPlainText(encodeHistoryDocument(node.toJSON())),historyPlainText(encodeHistoryDocument(doc)))
  }
})
