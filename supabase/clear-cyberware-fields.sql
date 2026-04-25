-- Corre este SQL no Supabase SQL Editor para limpar todo o cyberware guardado
-- nas fichas web: catalogo privado, slots equipados e limites dos medidores.

with cyberware_reset as (
  select jsonb_build_object(
    'P4_CYBERWARE_CATALOG', '[]',
    'P4_FRONTAL_CORTEX', '[]',
    'P4_SKELETON', '[]',
    'P4_NERVOUS_SYSTEM', '[]',
    'P4_LEGS', '[]',
    'P4_OPERATING_SYSTEM', '[]',
    'P4_EYES', '[]',
    'P4_ARMS', '[]',
    'P4_CIRCULATORY_SYSTEM', '[]',
    'P4_CYBER_MAX', '',
    'P4_SHIELD_MAX', ''
  ) as field_patch
)
update public.character_sheet_forms as sheet
set
  field_data = coalesce(sheet.field_data, '{}'::jsonb) || cyberware_reset.field_patch,
  updated_at = timezone('utc', now())
from cyberware_reset;

do $$
begin
  if exists (
    select 1
    from pg_tables
    where schemaname = 'public'
      and tablename = 'npc_cards'
  ) then
    with cyberware_reset as (
      select jsonb_build_object(
        'P4_CYBERWARE_CATALOG', '[]',
        'P4_FRONTAL_CORTEX', '[]',
        'P4_SKELETON', '[]',
        'P4_NERVOUS_SYSTEM', '[]',
        'P4_LEGS', '[]',
        'P4_OPERATING_SYSTEM', '[]',
        'P4_EYES', '[]',
        'P4_ARMS', '[]',
        'P4_CIRCULATORY_SYSTEM', '[]',
        'P4_CYBER_MAX', '',
        'P4_SHIELD_MAX', ''
      ) as field_patch
    )
    update public.npc_cards as card
    set
      field_data = coalesce(card.field_data, '{}'::jsonb) || cyberware_reset.field_patch,
      updated_at = timezone('utc', now())
    from cyberware_reset;
  end if;
end $$;
