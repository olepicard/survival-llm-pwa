#!/usr/bin/env python3
"""
Local development server for Survival LLM PWA.
Serves static files with correct MIME types, CORS headers, and detects LAN IP for mobile connection.
"""

import http.server
import socket
import socketserver
import os
import sys

PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

def get_lan_ip():
    """Detect local LAN IP of this machine (e.g. 192.168.1.x)"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return '127.0.0.1'

class PWAHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def guess_type(self, path):
        if path.endswith('.webmanifest') or path.endswith('manifest.json'):
            return 'application/manifest+json'
        if path.endswith('.js') or path.endswith('.mjs'):
            return 'application/javascript; charset=utf-8'
        if path.endswith('.json'):
            return 'application/json; charset=utf-8'
        if path.endswith('.svg'):
            return 'image/svg+xml'
        return super().guess_type(path)

    def end_headers(self):
        # Enable CORS and Local Network Access
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

def main():
    lan_ip = get_lan_ip()
    print("=" * 65)
    print(" 🛡️  SURVIVAL LLM - SERVEUR LOCAL PWA")
    print("=" * 65)
    print(f" • Accès depuis ce PC :")
    print(f"   👉 http://localhost:{PORT}")
    print()
    print(f" • Accès depuis votre Samsung Galaxy S25 Ultra (même WiFi) :")
    print(f"   👉 http://{lan_ip}:{PORT}")
    print()
    print(" 💡 Astuce Android : Ouvrez ce lien dans Chrome ou Samsung Internet,")
    print("    puis appuyez sur le menu (⋮) > 'Ajouter à l'écran d'accueil'")
    print("    pour installer l'application en mode plein écran natif !")
    print("=" * 65)
    print("Appuyez sur Ctrl+C pour arrêter le serveur.\n")

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("0.0.0.0", PORT), PWAHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nArrêt du serveur.")

if __name__ == '__main__':
    main()
