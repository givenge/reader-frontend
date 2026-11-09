import http from './http'

export interface WebdavFileEntry {
  name: string
  size: number
  path: string
  lastModified: number
  isDirectory: boolean
}

export function getWebdavFileList(path = '/') {
  return http.get<WebdavFileEntry[]>('/getWebdavFileList', {
    params: { path },
  }).then((r) => r.data)
}

export function getWebdavFileText(path: string) {
  return http.get<string>('/getWebdavFile', {
    params: { path },
    responseType: 'text',
    transformResponse: [(value) => value],
  }).then((r) => r.data as unknown as string)
}

export function getWebdavFileBlob(path: string) {
  return http.get<Blob>('/getWebdavFile', {
    params: { path },
    responseType: 'blob',
  }).then((r) => r.data)
}

export function uploadFilesToWebdav(files: Array<{ file: Blob; name: string }>, path = '/') {
  const batches: Array<Array<{ file: Blob; name: string }>> = []
  for (let index = 0; index < files.length; index += 20) batches.push(files.slice(index, index + 20))
  return batches.reduce<Promise<WebdavFileEntry[]>>(async (promise, batch) => {
    const entries = await promise
    const formData = new FormData()
    formData.append('path', path)
    batch.forEach((item, index) => formData.append(`file${index}`, item.file, item.name))
    const response = await http.post<WebdavFileEntry[]>('/uploadFileToWebdav', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return entries.concat(response.data)
  }, Promise.resolve([]))
}

export function uploadTextToWebdav(content: string, filename: string, path = '/') {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  return uploadFilesToWebdav([{ file: blob, name: filename }], path)
}

export function deleteWebdavFile(path: string) {
  return http.post<string>('/deleteWebdavFile', { path }).then((r) => r.data)
}

export function deleteWebdavFileList(paths: string[]) {
  const batches: string[][] = []
  for (let index = 0; index < paths.length; index += 1000) batches.push(paths.slice(index, index + 1000))
  return batches.reduce<Promise<string>>(async (promise, batch) => {
    await promise
    const response = await http.post<string>('/deleteWebdavFileList', { path: batch })
    return response.data
  }, Promise.resolve(''))
}
