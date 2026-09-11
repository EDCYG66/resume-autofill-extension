"""Generates the manifest `key` that pins this extension's ID.

Chrome derives an unpacked extension's ID from its absolute path, so loading the same
extension from a different folder yields a different ID and a different storage area.
A `key` in the manifest replaces that path hash with a fixed public key hash, which makes
the ID stable no matter where the extension lives.

manifest.json already carries a pinned key, so you should not need to run this. Running it
again produces a DIFFERENT key and therefore a DIFFERENT extension ID, which orphans whatever
the user has already saved. Only run it if you deliberately want to start a new identity.

Run:  python tools/make_extension_key.py
It prints the base64 key, the resulting extension ID, and the private key.
The manifest only needs the public key; keep the private key only if you plan to publish a .crx.
"""
import base64
import hashlib
import os

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa


def extension_id(public_key_der):
    """Chrome maps the first 16 bytes of the SHA-256 to the letters a-p."""
    digest = hashlib.sha256(public_key_der).hexdigest()[:32]
    return ''.join(chr(ord('a') + int(c, 16)) for c in digest)


def build():
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_der = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    return private_key, base64.b64encode(public_der).decode('ascii'), extension_id(public_der)


if __name__ == '__main__':
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    private_key, public_b64, ext_id = build()
    print('extension ID :', ext_id)
    print('manifest key :', public_b64)
    print()
    print('Keep the private key if you ever want to publish a .crx:')
    print(private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode('ascii'))
