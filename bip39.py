#crea una frase bip39
import hashlib
import base58
import ecdsa
import mnemonic

#crea una frase bip39
def crea_frase():
    #crea una frase bip39
    frase = mnemonic.Mnemonic('english')
    frase = frase.generate(strength=128)
    return frase

#crea una clave privada
def crea_clave_privada():
    #crea una frase bip39
    frase = crea_frase()
    #crea una clave privada
    clave_privada = mnemonic.Mnemonic.to_seed(frase)
    return clave_privada

#crea una clave publica
def crea_clave_publica(clave_privada):
    #crea una clave publica
    clave_publica = ecdsa.SigningKey.from_string(clave_privada).verifying_key.to_string()
    return clave_publica

#crea una direccion
def crea_direccion(clave_publica):
    #crea una direccion
    clave_publica = hashlib.sha256(clave_publica).digest()
    clave_publica = hashlib.new('ripemd160', clave_publica).digest()
    clave_publica = b'\x00' + clave_publica
    clave_publica = hashlib.sha256(clave_publica).digest()
    clave_publica = hashlib.sha256(clave_publica).digest()
    clave_publica = base58.b58encode(clave_publica)
    return clave_publica

#print clave_privada
print(crea_clave_privada())
#print clave_publica
print(crea_clave_publica(crea_clave_privada()))
#print direccion
print(crea_direccion(crea_clave_publica(crea_clave_privada())))