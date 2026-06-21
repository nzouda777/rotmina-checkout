'use client'

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'

interface AdminContextType {
  adminKey: string
  isAuthed: boolean
  authChecked: boolean
  login: (key: string) => void
  logout: () => void
  apiFetch: (url: string, options?: RequestInit) => Promise<Response>
}

const AdminContext = createContext<AdminContextType | null>(null)

export function AdminProvider({ children }: { children: ReactNode }) {
  const [adminKey, setAdminKey] = useState('')
  const [isAuthed, setIsAuthed] = useState(false)
  const [authChecked, setAuthChecked] = useState(false)

  useEffect(() => {
    const saved = sessionStorage.getItem('rotmina-admin-key')
    if (saved) {
      setAdminKey(saved)
      setIsAuthed(true)
    }
    setAuthChecked(true)
  }, [])

  const login = useCallback((key: string) => {
    sessionStorage.setItem('rotmina-admin-key', key)
    setAdminKey(key)
    setIsAuthed(true)
  }, [])

  const logout = useCallback(() => {
    sessionStorage.removeItem('rotmina-admin-key')
    setAdminKey('')
    setIsAuthed(false)
  }, [])

  const apiFetch = useCallback(
    (url: string, options: RequestInit = {}) =>
      fetch(url, {
        ...options,
        headers: { ...(options.headers as Record<string, string>), 'x-admin-key': adminKey },
      }),
    [adminKey]
  )

  return (
    <AdminContext.Provider value={{ adminKey, isAuthed, authChecked, login, logout, apiFetch }}>
      {children}
    </AdminContext.Provider>
  )
}

export function useAdmin() {
  const ctx = useContext(AdminContext)
  if (!ctx) throw new Error('useAdmin must be used within AdminProvider')
  return ctx
}
