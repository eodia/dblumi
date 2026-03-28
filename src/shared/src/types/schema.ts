export type SchemaTable = {
  name: string
  schema: string
  estimatedRows?: number
  columns: SchemaColumn[]
}

export type SchemaColumn = {
  name: string
  dataType: string
  isNullable: boolean
  isPrimaryKey: boolean
  isForeignKey: boolean
  defaultValue: string | null
  references?: {
    table: string
    column: string
  }
}

export type SchemaView = {
  name: string
  schema: string
  definition?: string
}

export type SchemaFunction = {
  name: string
  schema: string
  returnType: string
  arguments: string
}

export type DbSchema = {
  tables: SchemaTable[]
  views: SchemaView[]
  functions: SchemaFunction[]
}
