import { useEffect } from 'react'
import { useEditorStore } from '@/stores/editor.store'
import { useQuery } from '@tanstack/react-query'
import { connectionsApi } from '@/api/connections'

import faviconDefault from '@/assets/favicon.svg'
import faviconPostgresql from '@/assets/favicon-postgresql.svg'
import faviconMysql from '@/assets/favicon-mysql.svg'
import faviconMongodb from '@/assets/favicon-mongodb.svg'
import faviconOracle from '@/assets/favicon-oracle.svg'
import faviconSqlite from '@/assets/favicon-sqlite.svg'

const faviconByDriver: Record<string, string> = {
  postgresql: faviconPostgresql,
  mysql: faviconMysql,
  mongodb: faviconMongodb,
  oracle: faviconOracle,
  sqlite: faviconSqlite,
}

const envColor: Record<string, string> = {
  prod: '#ef4444',
  staging: '#f59e0b',
  dev: '#5DE847',
  local: '#888888',
}

function buildFaviconWithEnvDot(svgUrl: string, environment: string | null | undefined): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const size = 64
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, size, size)

      const env = environment?.toLowerCase()
      if (env && envColor[env]) {
        const dotRadius = 10
        const cx = dotRadius + 2
        const cy = size - dotRadius - 2
        ctx.beginPath()
        ctx.arc(cx, cy, dotRadius + 2, 0, Math.PI * 2)
        ctx.fillStyle = '#1a1a1a'
        ctx.fill()
        ctx.beginPath()
        ctx.arc(cx, cy, dotRadius, 0, Math.PI * 2)
        ctx.fillStyle = envColor[env]
        ctx.fill()
      }

      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => resolve(svgUrl)
    img.src = svgUrl
  })
}

function setFavicon(href: string) {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  link.type = href.startsWith('data:') ? 'image/png' : 'image/svg+xml'
  link.href = href
}

export function useDynamicHead() {
  const { tabs, activeTabId, activeConnectionId } = useEditorStore()
  const activeTab = tabs.find((t) => t.id === activeTabId)

  const { data: connListData } = useQuery({
    queryKey: ['connections'],
    queryFn: connectionsApi.list,
    staleTime: 5 * 60 * 1000,
  })

  const connection = connListData?.connections.find((c) => c.id === activeConnectionId)

  // Update favicon
  useEffect(() => {
    if (!connection) {
      setFavicon(faviconDefault)
      return
    }

    const svgUrl = faviconByDriver[connection.driver] ?? faviconDefault
    let cancelled = false

    buildFaviconWithEnvDot(svgUrl, connection.environment).then((href) => {
      if (!cancelled) setFavicon(href)
    })

    return () => { cancelled = true }
  }, [connection?.driver, connection?.environment])

  // Update title
  useEffect(() => {
    const parts: string[] = []
    if (activeTab?.name) parts.push(activeTab.name)
    if (connection?.name) parts.push(connection.name)
    parts.push('dblumi')
    document.title = parts.join(' - ')
  }, [activeTab?.name, connection?.name])
}
