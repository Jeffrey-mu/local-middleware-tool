import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { dataDir } from './paths.ts'

const pricingPath = path.join(dataDir, 'model-pricing.json')

export const modelPricingSchema = z.object({
  model: z.string().min(1),
  inputUsdPerMillion: z.number().min(0).default(0),
  cachedInputUsdPerMillion: z.number().min(0).default(0),
  outputUsdPerMillion: z.number().min(0).default(0),
  source: z.string().default('manual'),
  updatedAt: z.string().default(() => new Date().toISOString()),
})

export const pricingTableSchema = z.object({
  models: z.array(modelPricingSchema).default([]),
})

export type ModelPricing = z.infer<typeof modelPricingSchema>
export type PricingTable = z.infer<typeof pricingTableSchema>

const defaultPricingTable: PricingTable = {
  models: [],
}

export async function loadPricingTable() {
  try {
    const raw = await readFile(pricingPath, 'utf8')
    return pricingTableSchema.parse(JSON.parse(raw))
  } catch {
    await savePricingTable(defaultPricingTable)
    return defaultPricingTable
  }
}

export async function savePricingTable(table: PricingTable) {
  const normalized = pricingTableSchema.parse({
    models: table.models.map((item) => ({
      ...item,
      model: item.model.trim(),
      source: item.source.trim() || 'manual',
      updatedAt: item.updatedAt || new Date().toISOString(),
    })).filter((item) => item.model),
  })

  await mkdir(path.dirname(pricingPath), { recursive: true })
  await writeFile(pricingPath, JSON.stringify(normalized, null, 2))
  return normalized
}

export function estimateCostUsd(
  table: PricingTable,
  model: string,
  usage: { promptTokens: number; cachedTokens?: number; completionTokens: number },
) {
  const pricing = findModelPricing(table, model)
  if (!pricing) return 0

  return (
    usage.promptTokens * perToken(pricing.inputUsdPerMillion) +
    (usage.cachedTokens ?? 0) * perToken(pricing.cachedInputUsdPerMillion) +
    usage.completionTokens * perToken(pricing.outputUsdPerMillion)
  )
}

export function findModelPricing(table: PricingTable, model: string) {
  return table.models.find((item) => item.model === model)
    ?? table.models.find((item) => item.model === '*')
    ?? null
}

function perToken(usdPerMillion: number) {
  return usdPerMillion / 1_000_000
}
