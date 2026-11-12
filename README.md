# Gestão Loja 3D (Shopee)

Pedidos, fila de produção, margem de contribuição, lucro final, estoque de insumos com ponto de pedido e ponto de equilíbrio.
Stack: Next.js 15 + Supabase (Postgres, Auth). Toda a regra de negócio fica no banco (triggers e views), então o front é fino.

## Instalação

1. **Supabase**: crie o projeto, abra o *SQL Editor* e rode `supabase/schema.sql` inteiro.
2. **Usuário**: Authentication → Users → *Add user* (e-mail + senha). Sem cadastro público.
3. **Variáveis**: copie `.env.example` para `.env.local` e preencha a URL e a chave anon (Project Settings → API).
4. `npm install` e `npm run dev` (ou importe o repositório na Vercel com as mesmas variáveis).

## Primeiros passos no app

1. **Configurações**: imposto, energia (R$/kWh), consumo da impressora, depreciação/hora, % de perdas, frete pago pela loja. Taxas da Shopee já vêm com a tabela vigente desde 01/10/2026.
2. **Estoque → Novo insumo**: filamentos em **gramas** (custo por grama = preço do rolo ÷ 1000), caixas, argolas, etiquetas… com estoque inicial, prazo do fornecedor e um mínimo manual.
3. **Configurações → Embalagem por pedido**: a caixa, a etiqueta etc. que vão em todo pedido.
4. **Produtos**: preço, tempo de impressão, **SKU igual ao da Shopee** e ficha técnica (g de filamento, 1 argola…). O simulador mostra o preço mínimo e o preço para a margem desejada.
5. **Financeiro → Custos fixos**: DAS/MEI, internet, aluguel, assinaturas, pró-labore.
6. **Pedidos → Importar planilha Shopee** (Seller Centre → Meus pedidos → Exportar) ou cadastrar manualmente.

## Como funciona

| Evento | O que acontece automaticamente |
|---|---|
| Item de pedido criado | grava custo e taxa da época; cria tarefa na fila |
| Tarefa → imprimindo | pedido passa para *Em produção* |
| Tarefa → concluída | baixa filamento (+% perdas) e acessórios; se todas concluídas, pedido fica *Pronto* |
| Tarefa → falhou | material vira *perda* e a peça volta para a fila com prioridade maior |
| "Usar pronto" | consome do estoque de peças prontas, sem gastar material |
| Pedido → enviado | baixa o kit de embalagem |
| Pedido → cancelado | remove da fila o que ainda não começou |
| Compra → recebida | entra no estoque e atualiza o custo médio ponderado |

**Margem de contribuição** = receita − taxas Shopee − imposto − custo de produção − embalagem − frete da loja.
**Lucro líquido** = margem de contribuição do mês − custos fixos. **Margem final** = lucro ÷ faturamento.
**Ponto de equilíbrio** = custos fixos ÷ (MC ÷ faturamento), também em nº de pedidos.

**Reposição de estoque** (`vw_estoque_reposicao`):
- *disponível* = estoque − o que a fila e os pedidos não enviados ainda vão consumir
- *ponto de pedido* = consumo médio diário × (prazo do fornecedor + dias de segurança), nunca abaixo do mínimo manual
- situação: **Em falta** (disponível ≤ 0) · **Crítico** (abaixo da segurança) · **Comprar** (disponível + em trânsito ≤ ponto de pedido) · OK
- *sugestão* = quanto comprar para cobrir prazo + segurança + horizonte de compra

## Importação Shopee

- Colunas reconhecidas automaticamente (dá para ajustar o mapeamento na tela).
- Pedido já importado não duplica: só atualiza para enviado/entregue/cancelado/devolvido.
- Pedidos antigos já enviados entram como **histórico** (contam no financeiro, não geram produção nem baixa).
- Item sem SKU cadastrado: você vincula a um produto uma vez e o vínculo fica salvo para as próximas importações.
- Se a planilha trouxer as taxas cobradas, o sistema usa as taxas reais; senão calcula pela tabela.
