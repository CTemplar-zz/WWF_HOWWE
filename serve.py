#!/usr/bin/env python3
"""
Servidor HTTP local con soporte de HTTP Range requests (necesario para PMTiles).
El http.server estándar de Python no soporta Range, así que extendemos
SimpleHTTPRequestHandler para devolver 206 Partial Content cuando el cliente
envía el header Range.

Uso:
    python serve.py            # puerto 8000
    python serve.py 8080       # puerto custom
Luego abrir: http://localhost:8000/
"""
import http.server
import os
import re
import socketserver
import sys


class RangeRequestHandler(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            return super().send_head()
        try:
            f = open(path, 'rb')
        except OSError:
            self.send_error(404, "File not found")
            return None

        try:
            fs = os.fstat(f.fileno())
            file_size = fs.st_size
            ctype = self.guess_type(path)

            range_header = self.headers.get('Range')
            if range_header:
                m = re.match(r'bytes=(\d*)-(\d*)$', range_header.strip())
                if m:
                    start_s, end_s = m.group(1), m.group(2)
                    if start_s == '' and end_s != '':
                        # Sufijo: últimos N bytes
                        n = int(end_s)
                        start = max(0, file_size - n)
                        end = file_size - 1
                    else:
                        start = int(start_s) if start_s else 0
                        end = int(end_s) if end_s else file_size - 1
                        end = min(end, file_size - 1)

                    if start >= file_size or start > end:
                        self.send_response(416, "Requested Range Not Satisfiable")
                        self.send_header("Content-Range", f"bytes */{file_size}")
                        self.send_header("Content-Length", "0")
                        self.end_headers()
                        f.close()
                        return None

                    content_length = end - start + 1
                    self.send_response(206)
                    self.send_header("Content-Type", ctype)
                    self.send_header("Accept-Ranges", "bytes")
                    self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
                    self.send_header("Content-Length", str(content_length))
                    self.send_header("Last-Modified", self.date_time_string(int(fs.st_mtime)))
                    self.end_headers()

                    if self.command != 'HEAD':
                        f.seek(start)
                        remaining = content_length
                        chunk_size = 64 * 1024
                        while remaining > 0:
                            chunk = f.read(min(chunk_size, remaining))
                            if not chunk:
                                break
                            self.wfile.write(chunk)
                            remaining -= len(chunk)
                    f.close()
                    return None

            # Sin Range → respuesta normal 200
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(file_size))
            self.send_header("Last-Modified", self.date_time_string(int(fs.st_mtime)))
            self.end_headers()
            return f
        except Exception:
            f.close()
            raise


class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = RangeRequestHandler
    with ReusableTCPServer(("", port), handler) as httpd:
        print(f"Sirviendo en http://localhost:{port}/ con soporte de Range requests")
        print("Ctrl+C para detener.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nDeteniendo.")
