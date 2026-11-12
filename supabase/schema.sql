-- =====================================================================
--  LOJA SHOPEE 3D — Pedidos, Produção, Margens, Estoque e Equilíbrio
--  Script único para o SQL Editor do Supabase (pode rodar de uma vez).
--  Idempotente na criação: use em um projeto novo.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 1. CONFIGURAÇÕES GERAIS (linha única, id = 1)
-- ---------------------------------------------------------------------
create table if not exists configuracoes (
  id                      int primary key default 1 check (id = 1),
  nome_loja               text    not null default 'Minha Loja 3D',
  tipo_vendedor           text    not null default 'cnpj' check (tipo_vendedor in ('cnpj','cpf')),
  adicional_cpf_item      numeric not null default 0,      -- R$ 3,00 se CPF com +450 pedidos/90 dias
  aliquota_imposto_pct    numeric not null default 0,      -- ex.: 6 (Simples Nacional) ou 0 (MEI)
  custo_kwh               numeric not null default 0.95,   -- R$ por kWh
  potencia_impressora_w   numeric not null default 150,    -- consumo médio da impressora (W)
  depreciacao_hora        numeric not null default 0.50,   -- R$ por hora de máquina (desgaste, bico, mesa)
  perda_falhas_pct        numeric not null default 5,      -- % extra de filamento p/ falhas e purga
  frete_vendedor_padrao   numeric not null default 0,      -- parcela do frete assumida por pedido
  dias_seguranca          int     not null default 7,      -- estoque de segurança, em dias de consumo
  dias_horizonte_compra   int     not null default 30,     -- cobertura desejada a cada compra
  dias_media_consumo      int     not null default 30,     -- janela p/ calcular consumo médio
  meta_margem_pct         numeric not null default 30,     -- margem de contribuição alvo (simulador)
  updated_at              timestamptz not null default now()
);
insert into configuracoes (id) values (1) on conflict do nothing;

-- Faixas de comissão Shopee (tabela vigente desde 01/10/2026 — edite quando mudar)
create table if not exists faixas_taxa_shopee (
  id            uuid primary key default gen_random_uuid(),
  preco_min     numeric not null,
  preco_max     numeric,                 -- null = sem limite
  comissao_pct  numeric not null,
  taxa_fixa     numeric not null,
  created_at    timestamptz not null default now()
);
insert into faixas_taxa_shopee (preco_min, preco_max, comissao_pct, taxa_fixa)
select * from (values
  (0::numeric,     79.99::numeric, 20::numeric, 4.50::numeric),
  (80,             99.99,          14,          16),
  (100,            199.99,         14,          20),
  (200,            null,           14,          26)
) v where not exists (select 1 from faixas_taxa_shopee);

-- ---------------------------------------------------------------------
-- 2. INSUMOS (filamentos, caixas, argolas, etiquetas, etc.)
-- ---------------------------------------------------------------------
create table if not exists insumos (
  id                    uuid primary key default gen_random_uuid(),
  nome                  text    not null,
  categoria             text    not null default 'filamento'
                        check (categoria in ('filamento','embalagem','acessorio','outro')),
  unidade               text    not null default 'g',        -- g, un, m
  material              text,                                -- PLA, PETG, TPU...
  cor                   text,
  custo_unitario        numeric not null default 0,          -- custo médio ponderado por unidade
  estoque_atual         numeric not null default 0,
  lead_time_dias        int     not null default 7,          -- prazo de entrega do fornecedor
  estoque_minimo_manual numeric not null default 0,          -- piso manual (útil sem histórico)
  fornecedor            text,
  link_compra           text,
  ativo                 boolean not null default true,
  created_at            timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3. PRODUTOS + FICHA TÉCNICA
-- ---------------------------------------------------------------------
create table if not exists produtos (
  id                  uuid primary key default gen_random_uuid(),
  sku                 text unique,
  nome                text    not null,
  variacao            text,
  preco_venda         numeric not null default 0,
  tempo_impressao_min numeric not null default 0,   -- por unidade
  custo_extra         numeric not null default 0,   -- mão de obra/acabamento/outros por unidade
  estoque_pronto      int     not null default 0,   -- unidades já impressas
  ativo               boolean not null default true,
  created_at          timestamptz not null default now()
);

create table if not exists produto_insumos (
  id          uuid primary key default gen_random_uuid(),
  produto_id  uuid not null references produtos(id) on delete cascade,
  insumo_id   uuid not null references insumos(id)  on delete restrict,
  quantidade  numeric not null check (quantidade > 0),   -- por unidade do produto
  unique (produto_id, insumo_id)
);

-- Textos da planilha Shopee vinculados a um produto (SKU/nome/variação)
create table if not exists produto_aliases (
  id          uuid primary key default gen_random_uuid(),
  texto       text not null unique,
  produto_id  uuid not null references produtos(id) on delete cascade
);

-- Kit de embalagem consumido por PEDIDO (caixa, etiqueta, plástico bolha...)
create table if not exists embalagem_padrao (
  id          uuid primary key default gen_random_uuid(),
  insumo_id   uuid not null unique references insumos(id) on delete cascade,
  quantidade  numeric not null default 1 check (quantidade > 0)
);

-- ---------------------------------------------------------------------
-- 4. PEDIDOS
-- ---------------------------------------------------------------------
create table if not exists pedidos (
  id                 uuid primary key default gen_random_uuid(),
  numero_shopee      text unique,
  origem             text not null default 'shopee' check (origem in ('shopee','manual','outro')),
  cliente            text,
  data_pedido        timestamptz not null default now(),
  prazo_envio        date,
  status             text not null default 'novo'
                     check (status in ('novo','em_producao','pronto','enviado','entregue','cancelado','devolvido')),
  desconto_loja      numeric not null default 0,   -- cupom pago pela loja
  frete_vendedor     numeric not null default 0,   -- frete assumido pela loja
  taxas_reais        numeric,                      -- taxas informadas pela Shopee (se importadas)
  historico          boolean not null default false, -- importado já enviado: não gera produção/baixa
  embalagem_baixada  boolean not null default false,
  observacoes        text,
  created_at         timestamptz not null default now()
);
create index if not exists pedidos_data_idx on pedidos (data_pedido);
create index if not exists pedidos_status_idx on pedidos (status);

create table if not exists pedido_itens (
  id               uuid primary key default gen_random_uuid(),
  pedido_id        uuid not null references pedidos(id) on delete cascade,
  produto_id       uuid references produtos(id) on delete set null,
  descricao        text,
  quantidade       int     not null check (quantidade > 0),
  preco_unitario   numeric not null default 0,
  custo_unitario   numeric,   -- snapshot do custo variável na data da venda
  taxa_unitaria    numeric,   -- snapshot da taxa Shopee calculada por unidade
  created_at       timestamptz not null default now()
);
create index if not exists pedido_itens_pedido_idx on pedido_itens (pedido_id);

-- ---------------------------------------------------------------------
-- 5. FILA DE PRODUÇÃO
-- ---------------------------------------------------------------------
create table if not exists fila_producao (
  id               uuid primary key default gen_random_uuid(),
  pedido_item_id   uuid references pedido_itens(id) on delete cascade, -- null = produção p/ estoque
  produto_id       uuid not null references produtos(id) on delete cascade,
  quantidade       int  not null check (quantidade > 0),
  status           text not null default 'aguardando'
                   check (status in ('aguardando','imprimindo','acabamento','concluido','falhou')),
  do_estoque       boolean not null default false,  -- atendido com estoque pronto
  prioridade       int  not null default 0,         -- maior = antes
  impressora       text,
  prazo            date,
  iniciado_em      timestamptz,
  concluido_em     timestamptz,
  insumos_baixados boolean not null default false,
  created_at       timestamptz not null default now()
);
create index if not exists fila_status_idx on fila_producao (status);

-- ---------------------------------------------------------------------
-- 6. ESTOQUE: MOVIMENTOS E COMPRAS
-- ---------------------------------------------------------------------
create table if not exists movimentos_estoque (
  id              uuid primary key default gen_random_uuid(),
  insumo_id       uuid not null references insumos(id) on delete cascade,
  tipo            text not null check (tipo in ('entrada','saida_producao','saida_embalagem','perda','ajuste')),
  quantidade      numeric not null,          -- positivo entra, negativo sai
  custo_unitario  numeric,
  referencia_id   uuid,
  observacao      text,
  created_at      timestamptz not null default now()
);
create index if not exists mov_insumo_data_idx on movimentos_estoque (insumo_id, created_at);

create table if not exists compras (
  id                uuid primary key default gen_random_uuid(),
  insumo_id         uuid not null references insumos(id) on delete cascade,
  quantidade        numeric not null check (quantidade > 0),
  valor_total       numeric not null default 0,   -- inclui frete da compra
  fornecedor        text,
  status            text not null default 'pedido' check (status in ('pedido','recebido','cancelado')),
  data_compra       date not null default current_date,
  previsao_chegada  date,
  recebido_em       timestamptz,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 7. CUSTOS FIXOS (para ponto de equilíbrio e lucro final)
-- ---------------------------------------------------------------------
create table if not exists custos_fixos (
  id            uuid primary key default gen_random_uuid(),
  descricao     text not null,
  valor_mensal  numeric not null default 0,
  ativo         boolean not null default true,
  created_at    timestamptz not null default now()
);

-- =====================================================================
--  FUNÇÕES DE CÁLCULO
-- =====================================================================

-- Taxa Shopee por UNIDADE para um preço (comissão + taxa fixa + adicional CPF)
-- Itens baratos: taxa fixa limitada a 50% do preço.
create or replace function fn_taxa_shopee(p_preco numeric)
returns numeric language sql stable as $$
  select coalesce((
    select round(p_preco * f.comissao_pct / 100
                 + least(f.taxa_fixa, p_preco * 0.5)
                 + c.adicional_cpf_item, 2)
    from faixas_taxa_shopee f, configuracoes c
    where c.id = 1
      and p_preco >= f.preco_min
      and (f.preco_max is null or p_preco < f.preco_max + 0.01)
    order by f.preco_min desc limit 1
  ), 0);
$$;

-- Custo variável de produção por UNIDADE (materiais c/ perdas + energia + depreciação + extra)
create or replace function fn_custo_produto(p_produto uuid)
returns numeric language sql stable as $$
  select round(
      coalesce((select sum(pi.quantidade * i.custo_unitario
                           * case when i.categoria = 'filamento' then 1 + c.perda_falhas_pct/100 else 1 end)
                from produto_insumos pi join insumos i on i.id = pi.insumo_id
                where pi.produto_id = p.id), 0)
    + p.tempo_impressao_min / 60.0 * c.potencia_impressora_w / 1000.0 * c.custo_kwh
    + p.tempo_impressao_min / 60.0 * c.depreciacao_hora
    + p.custo_extra, 4)
  from produtos p, configuracoes c
  where p.id = p_produto and c.id = 1;
$$;

-- Custo do kit de embalagem por pedido
create or replace function fn_custo_embalagem()
returns numeric language sql stable as $$
  select coalesce(sum(e.quantidade * i.custo_unitario), 0)
  from embalagem_padrao e join insumos i on i.id = e.insumo_id;
$$;

-- =====================================================================
--  TRIGGERS
-- =====================================================================

-- (a) Movimento de estoque atualiza saldo e custo médio ponderado
create or replace function trg_movimento_aplicar() returns trigger language plpgsql as $$
declare v_saldo numeric; v_custo numeric;
begin
  select estoque_atual, custo_unitario into v_saldo, v_custo from insumos where id = new.insumo_id for update;
  if new.tipo = 'entrada' and new.quantidade > 0 and new.custo_unitario is not null then
    update insumos set
      custo_unitario = case when greatest(v_saldo,0) + new.quantidade > 0
        then (greatest(v_saldo,0) * v_custo + new.quantidade * new.custo_unitario) / (greatest(v_saldo,0) + new.quantidade)
        else new.custo_unitario end,
      estoque_atual = v_saldo + new.quantidade
    where id = new.insumo_id;
  else
    update insumos set estoque_atual = v_saldo + new.quantidade where id = new.insumo_id;
  end if;
  return new;
end $$;
drop trigger if exists movimento_aplicar on movimentos_estoque;
create trigger movimento_aplicar after insert on movimentos_estoque
for each row execute function trg_movimento_aplicar();

-- (b) Compra recebida => entrada no estoque
create or replace function trg_compra_receber() returns trigger language plpgsql as $$
begin
  if new.status = 'recebido' and (tg_op = 'INSERT' or old.status <> 'recebido') then
    new.recebido_em := coalesce(new.recebido_em, now());
    insert into movimentos_estoque (insumo_id, tipo, quantidade, custo_unitario, referencia_id, observacao)
    values (new.insumo_id, 'entrada', new.quantidade, new.valor_total / new.quantidade, new.id,
            'Compra ' || coalesce(new.fornecedor, ''));
    if new.fornecedor is not null then
      update insumos set fornecedor = new.fornecedor where id = new.insumo_id and fornecedor is null;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists compra_receber on compras;
create trigger compra_receber before insert or update on compras
for each row execute function trg_compra_receber();

-- (c) Item de pedido: grava snapshots de custo/taxa e cria tarefa na fila
create or replace function trg_item_inserir() returns trigger language plpgsql as $$
declare v_ped pedidos%rowtype;
begin
  select * into v_ped from pedidos where id = new.pedido_id;
  if new.produto_id is not null then
    new.custo_unitario := coalesce(new.custo_unitario, fn_custo_produto(new.produto_id));
  end if;
  new.taxa_unitaria := coalesce(new.taxa_unitaria,
    case when v_ped.origem = 'shopee' then fn_taxa_shopee(new.preco_unitario) else 0 end);
  return new;
end $$;
drop trigger if exists item_inserir on pedido_itens;
create trigger item_inserir before insert on pedido_itens
for each row execute function trg_item_inserir();

create or replace function trg_item_fila() returns trigger language plpgsql as $$
declare v_ped pedidos%rowtype;
begin
  select * into v_ped from pedidos where id = new.pedido_id;
  if new.produto_id is not null and not v_ped.historico
     and v_ped.status in ('novo','em_producao') then
    insert into fila_producao (pedido_item_id, produto_id, quantidade, prazo)
    values (new.id, new.produto_id, new.quantidade, v_ped.prazo_envio);
  end if;
  return null;
end $$;
drop trigger if exists item_fila on pedido_itens;
create trigger item_fila after insert on pedido_itens
for each row execute function trg_item_fila();

-- Vincular produto depois (item importado sem SKU reconhecido)
create or replace function trg_item_vincular() returns trigger language plpgsql as $$
declare v_ped pedidos%rowtype;
begin
  if old.produto_id is null and new.produto_id is not null then
    new.custo_unitario := fn_custo_produto(new.produto_id);
    select * into v_ped from pedidos where id = new.pedido_id;
    if not v_ped.historico and v_ped.status in ('novo','em_producao') then
      insert into fila_producao (pedido_item_id, produto_id, quantidade, prazo)
      values (new.id, new.produto_id, new.quantidade, v_ped.prazo_envio);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists item_vincular on pedido_itens;
create trigger item_vincular before update on pedido_itens
for each row execute function trg_item_vincular();

-- (d) Fila: baixa de insumos ao concluir/falhar, estoque pronto, status do pedido
create or replace function trg_fila_status() returns trigger language plpgsql as $$
declare v_pedido uuid; v_pend int;
begin
  if new.status = 'imprimindo' and old.status <> 'imprimindo' then
    new.iniciado_em := coalesce(new.iniciado_em, now());
  end if;

  if new.status in ('concluido','falhou') and old.status not in ('concluido','falhou') then
    new.concluido_em := now();

    if new.do_estoque then
      update produtos set estoque_pronto = estoque_pronto - new.quantidade where id = new.produto_id;
    elsif not new.insumos_baixados then
      insert into movimentos_estoque (insumo_id, tipo, quantidade, custo_unitario, referencia_id, observacao)
      select pi.insumo_id,
             case when new.status = 'falhou' then 'perda' else 'saida_producao' end,
             -(pi.quantidade * new.quantidade
               * case when i.categoria = 'filamento' and new.status = 'concluido'
                      then 1 + c.perda_falhas_pct/100 else 1 end),
             i.custo_unitario, new.id,
             case when new.status = 'falhou' then 'Impressão falhou' else 'Produção' end
      from produto_insumos pi join insumos i on i.id = pi.insumo_id, configuracoes c
      where pi.produto_id = new.produto_id and c.id = 1;
      new.insumos_baixados := true;

      if new.status = 'concluido' and new.pedido_item_id is null then
        update produtos set estoque_pronto = estoque_pronto + new.quantidade where id = new.produto_id;
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists fila_status on fila_producao;
create trigger fila_status before update on fila_producao
for each row execute function trg_fila_status();

create or replace function trg_fila_pos() returns trigger language plpgsql as $$
declare v_pedido uuid; v_pend int; v_status text;
begin
  -- falha: recoloca na fila automaticamente
  if new.status = 'falhou' and old.status <> 'falhou' then
    insert into fila_producao (pedido_item_id, produto_id, quantidade, prazo, prioridade, impressora)
    values (new.pedido_item_id, new.produto_id, new.quantidade, new.prazo, new.prioridade + 1, new.impressora);
  end if;

  if new.pedido_item_id is not null then
    select pedido_id into v_pedido from pedido_itens where id = new.pedido_item_id;
    select status into v_status from pedidos where id = v_pedido;
    if v_status in ('novo','em_producao') then
      select count(*) into v_pend
      from fila_producao f join pedido_itens it on it.id = f.pedido_item_id
      where it.pedido_id = v_pedido and f.status not in ('concluido','falhou');
      if v_pend = 0 then
        update pedidos set status = 'pronto' where id = v_pedido;
      elsif new.status in ('imprimindo','acabamento','concluido') and v_status = 'novo' then
        update pedidos set status = 'em_producao' where id = v_pedido;
      end if;
    end if;
  end if;
  return null;
end $$;
drop trigger if exists fila_pos on fila_producao;
create trigger fila_pos after update on fila_producao
for each row execute function trg_fila_pos();

-- (e) Pedido: embalagem ao enviar; cancelamento limpa a fila pendente
create or replace function trg_pedido_status() returns trigger language plpgsql as $$
begin
  if new.status in ('enviado','entregue') and not new.embalagem_baixada and not new.historico
     and old.status not in ('enviado','entregue') then
    insert into movimentos_estoque (insumo_id, tipo, quantidade, custo_unitario, referencia_id, observacao)
    select e.insumo_id, 'saida_embalagem', -e.quantidade, i.custo_unitario, new.id, 'Embalagem do pedido'
    from embalagem_padrao e join insumos i on i.id = e.insumo_id;
    new.embalagem_baixada := true;
  end if;

  if new.status = 'cancelado' and old.status <> 'cancelado' then
    delete from fila_producao f using pedido_itens it
    where it.id = f.pedido_item_id and it.pedido_id = new.id and f.status = 'aguardando';
  end if;
  return new;
end $$;
drop trigger if exists pedido_status on pedidos;
create trigger pedido_status before update on pedidos
for each row execute function trg_pedido_status();

-- =====================================================================
--  VIEWS DE ANÁLISE
-- =====================================================================

-- Margem de contribuição por produto (venda unitária na Shopee, 1 item por pedido)
create or replace view vw_produtos_margem with (security_invoker = true) as
select p.id, p.sku, p.nome, p.variacao, p.preco_venda, p.tempo_impressao_min, p.estoque_pronto, p.ativo,
       fn_custo_produto(p.id)                               as custo_producao,
       fn_taxa_shopee(p.preco_venda)                        as taxa_shopee,
       round(p.preco_venda * c.aliquota_imposto_pct / 100, 2) as imposto,
       fn_custo_embalagem()                                 as custo_embalagem,
       c.frete_vendedor_padrao                              as frete_vendedor,
       round(p.preco_venda - fn_custo_produto(p.id) - fn_taxa_shopee(p.preco_venda)
             - p.preco_venda * c.aliquota_imposto_pct / 100 - fn_custo_embalagem()
             - c.frete_vendedor_padrao, 2)                  as margem_contribuicao,
       case when p.preco_venda > 0 then round(100 * (p.preco_venda - fn_custo_produto(p.id)
             - fn_taxa_shopee(p.preco_venda) - p.preco_venda * c.aliquota_imposto_pct / 100
             - fn_custo_embalagem() - c.frete_vendedor_padrao) / p.preco_venda, 1) end as margem_contribuicao_pct
from produtos p, configuracoes c
where c.id = 1;

-- Resultado por pedido
create or replace view vw_pedidos_resultado with (security_invoker = true) as
with it as (
  select pedido_id,
         sum(quantidade * preco_unitario)                  as receita_bruta,
         sum(quantidade * coalesce(custo_unitario, 0))     as custo_produtos,
         sum(quantidade * coalesce(taxa_unitaria, 0))      as taxas_calc,
         sum(quantidade)                                   as unidades,
         count(*) filter (where produto_id is null)        as itens_sem_produto
  from pedido_itens group by pedido_id
),
emb as (
  select referencia_id as pedido_id, -sum(quantidade * coalesce(custo_unitario,0)) as custo_emb
  from movimentos_estoque where tipo = 'saida_embalagem' group by referencia_id
)
select p.*,
       coalesce(it.receita_bruta, 0)                          as receita_bruta,
       coalesce(it.receita_bruta, 0) - p.desconto_loja        as receita_liquida,
       coalesce(p.taxas_reais, it.taxas_calc, 0)              as taxas_shopee,
       round((coalesce(it.receita_bruta,0) - p.desconto_loja) * c.aliquota_imposto_pct / 100, 2) as imposto,
       coalesce(it.custo_produtos, 0)                         as custo_produtos,
       coalesce(emb.custo_emb, fn_custo_embalagem())          as custo_embalagem,
       coalesce(it.unidades, 0)                               as unidades,
       coalesce(it.itens_sem_produto, 0)                      as itens_sem_produto,
       round(coalesce(it.receita_bruta,0) - p.desconto_loja
             - coalesce(p.taxas_reais, it.taxas_calc, 0)
             - (coalesce(it.receita_bruta,0) - p.desconto_loja) * c.aliquota_imposto_pct / 100
             - coalesce(it.custo_produtos, 0)
             - coalesce(emb.custo_emb, fn_custo_embalagem())
             - p.frete_vendedor, 2)                           as margem_contribuicao
from pedidos p
left join it  on it.pedido_id = p.id
left join emb on emb.pedido_id = p.id
cross join configuracoes c
where c.id = 1;

-- Resultado mensal: MC, custos fixos, lucro final e ponto de equilíbrio
create or replace view vw_resultado_mensal with (security_invoker = true) as
with m as (
  select date_trunc('month', data_pedido)::date as mes,
         count(*)                         as pedidos,
         sum(unidades)                    as unidades,
         sum(receita_liquida)             as faturamento,
         sum(taxas_shopee)                as taxas,
         sum(imposto)                     as impostos,
         sum(custo_produtos + custo_embalagem + frete_vendedor) as custos_variaveis,
         sum(margem_contribuicao)         as margem_contribuicao
  from vw_pedidos_resultado
  where status not in ('cancelado','devolvido')
  group by 1
),
cf as (select coalesce(sum(valor_mensal),0) as custos_fixos from custos_fixos where ativo)
select m.*, cf.custos_fixos,
       round(m.margem_contribuicao - cf.custos_fixos, 2)                         as lucro_liquido,
       case when m.faturamento > 0 then round(100 * m.margem_contribuicao / m.faturamento, 1) end as margem_contribuicao_pct,
       case when m.faturamento > 0 then round(100 * (m.margem_contribuicao - cf.custos_fixos) / m.faturamento, 1) end as margem_lucro_pct,
       case when m.margem_contribuicao > 0 then round(cf.custos_fixos / (m.margem_contribuicao / m.faturamento), 2) end as faturamento_equilibrio,
       case when m.margem_contribuicao > 0 then ceil(cf.custos_fixos / (m.margem_contribuicao / m.pedidos)) end      as pedidos_equilibrio
from m, cf
order by m.mes desc;

-- Estoque: consumo médio, comprometido na fila, ponto de pedido e sugestão de compra
create or replace view vw_estoque_reposicao with (security_invoker = true) as
with c as (select * from configuracoes where id = 1),
consumo as (
  select m.insumo_id, -sum(m.quantidade) as saidas
  from movimentos_estoque m, c
  where m.quantidade < 0 and m.tipo in ('saida_producao','saida_embalagem','perda')
    and m.created_at >= now() - make_interval(days => c.dias_media_consumo)
  group by m.insumo_id
),
comprometido as (  -- o que a fila ainda vai consumir
  select pi.insumo_id,
         sum(pi.quantidade * f.quantidade
             * case when i.categoria = 'filamento' then 1 + c.perda_falhas_pct/100 else 1 end) as qtd
  from fila_producao f
  join produto_insumos pi on pi.produto_id = f.produto_id
  join insumos i on i.id = pi.insumo_id, c
  where f.status in ('aguardando','imprimindo','acabamento') and not f.do_estoque and not f.insumos_baixados
  group by pi.insumo_id
),
emb_pend as (      -- embalagens para pedidos ainda não enviados
  select e.insumo_id, sum(e.quantidade) as qtd
  from embalagem_padrao e
  cross join (select id from pedidos where status in ('novo','em_producao','pronto') and not historico) p
  group by e.insumo_id
),
transito as (
  select insumo_id, sum(quantidade) as qtd from compras where status = 'pedido' group by insumo_id
),
base as (
  select i.*,
         round(coalesce(consumo.saidas,0) / c.dias_media_consumo, 3)                   as consumo_diario,
         coalesce(comprometido.qtd,0) + coalesce(emb_pend.qtd,0)                        as comprometido,
         coalesce(transito.qtd,0)                                                       as em_transito,
         c.dias_seguranca, c.dias_horizonte_compra
  from insumos i
  cross join c
  left join consumo      on consumo.insumo_id = i.id
  left join comprometido on comprometido.insumo_id = i.id
  left join emb_pend     on emb_pend.insumo_id = i.id
  left join transito     on transito.insumo_id = i.id
  where i.ativo
),
calc as (
  select b.*,
         b.estoque_atual - b.comprometido                                              as disponivel,
         round(b.consumo_diario * b.dias_seguranca, 2)                                 as estoque_seguranca,
         greatest(round(b.consumo_diario * (b.lead_time_dias + b.dias_seguranca), 2),
                  b.estoque_minimo_manual)                                             as ponto_pedido
  from base b
)
select calc.*,
       case when calc.consumo_diario > 0 then round(calc.disponivel / calc.consumo_diario, 1) end as dias_cobertura,
       case
         when calc.disponivel <= 0 then 'falta'
         when calc.disponivel <= greatest(calc.estoque_seguranca, calc.estoque_minimo_manual * 0.5) then 'critico'
         when calc.disponivel + calc.em_transito <= calc.ponto_pedido then 'comprar'
         else 'ok'
       end as situacao,
       greatest(0, ceil(
         greatest(calc.ponto_pedido, calc.consumo_diario * (calc.lead_time_dias + calc.dias_horizonte_compra + calc.dias_seguranca))
         - (calc.disponivel + calc.em_transito)))                                      as sugestao_compra
from calc;

-- Fila ordenada com tempo estimado
create or replace view vw_fila with (security_invoker = true) as
select f.*, p.nome as produto_nome, p.variacao, p.sku, p.estoque_pronto,
       round(p.tempo_impressao_min * f.quantidade) as tempo_total_min,
       pe.id as pedido_id, pe.numero_shopee, pe.cliente, pe.status as pedido_status
from fila_producao f
join produtos p on p.id = f.produto_id
left join pedido_itens it on it.id = f.pedido_item_id
left join pedidos pe on pe.id = it.pedido_id;

-- =====================================================================
--  SEGURANÇA (RLS): qualquer usuário autenticado da loja tem acesso total.
--  Crie os usuários em Authentication > Users.
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['configuracoes','faixas_taxa_shopee','insumos','produtos','produto_insumos',
    'produto_aliases','embalagem_padrao','pedidos','pedido_itens','fila_producao','movimentos_estoque',
    'compras','custos_fixos']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists acesso_autenticado on %I', t);
    execute format('create policy acesso_autenticado on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
