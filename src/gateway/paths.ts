import path from 'node:path'

export const dataDir = process.env.CCSWITCH_DATA_DIR
  ? path.resolve(process.env.CCSWITCH_DATA_DIR)
  : path.join(process.cwd(), 'data')
