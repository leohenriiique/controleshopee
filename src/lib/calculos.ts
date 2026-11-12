// Réplica no front das funções SQL, usada no simulador de preço do produto.

export type Faixa = { preco_min: number; preco_max: number | null; comissao_pct: number; taxa_fixa: number };
export type Config = {
  adicional_cpf_item: number;
  aliquota_imposto_pct: number;
  custo_kwh: number;
  potencia_impressora_w: number;
  depreciacao_hora: number;
  perda_falhas_pct: number;
  frete_vendedor_padrao: number;
  meta_margem_pct: number;
};

const n = (v: any) => Number(v) || 0;

export function faixaDoPreco(faixas: Faixa[], preco: number) {
  return [...faixas]
    .sort((a, b) => n(b.preco_min) - n(a.preco_min))
    .find((f) => preco >= n(f.preco_min) && (f.preco_max === null || preco < n(f.preco_max) + 0.01));
}

export function taxaShopee(faixas: Faixa[], cfg: Config, preco: number) {
  const f = faixaDoPreco(faixas, preco);
  if (!f) return 0;
  return preco * n(f.comissao_pct) / 100 + Math.min(n(f.taxa_fixa), preco * 0.5) + n(cfg.adicional_cpf_item);
}

export function custoProducao(
  cfg: Config,
  tempoMin: number,
  custoExtra: number,
  ficha: { quantidade: number; custo_unitario: number; categoria: string }[]
) {
  const materiais = ficha.reduce(
    (s, f) => s + n(f.quantidade) * n(f.custo_unitario) * (f.categoria === "filamento" ? 1 + n(cfg.perda_falhas_pct) / 100 : 1),
    0
  );
  const energia = (n(tempoMin) / 60) * (n(cfg.potencia_impressora_w) / 1000) * n(cfg.custo_kwh);
  const depreciacao = (n(tempoMin) / 60) * n(cfg.depreciacao_hora);
  return { materiais, energia, depreciacao, extra: n(custoExtra), total: materiais + energia + depreciacao + n(custoExtra) };
}

/**
 * Menor preço que atinge a margem de contribuição alvo (em %).
 * p·(1 − comissão − imposto − meta) = custo + taxa fixa + adicional CPF + embalagem + frete
 */
export function precoParaMargem(faixas: Faixa[], cfg: Config, custoVariavel: number, embalagem: number, metaPct: number) {
  const ordenadas = [...faixas].sort((a, b) => n(a.preco_min) - n(b.preco_min));
  for (const f of ordenadas) {
    const den = 1 - n(f.comissao_pct) / 100 - n(cfg.aliquota_imposto_pct) / 100 - metaPct / 100;
    if (den <= 0) continue;
    const fixos = custoVariavel + n(f.taxa_fixa) + n(cfg.adicional_cpf_item) + embalagem + n(cfg.frete_vendedor_padrao);
    let p = fixos / den;
    // taxa fixa limitada a 50% do preço em itens baratos
    if (n(f.taxa_fixa) > p * 0.5) {
      const den2 = den - 0.5;
      if (den2 > 0) p = (fixos - n(f.taxa_fixa)) / den2;
    }
    if (p >= n(f.preco_min) && (f.preco_max === null || p < n(f.preco_max) + 0.01)) return Math.ceil(p * 100) / 100;
    if (p < n(f.preco_min)) {
      // o preço cai abaixo da faixa: o mínimo da faixa já atende
      return n(f.preco_min);
    }
  }
  return null;
}
