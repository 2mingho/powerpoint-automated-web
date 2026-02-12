import os
import sys
from werkzeug.security import generate_password_hash, check_password_hash

# Add root to path for imports if needed, though this is logic-only
def run_test():
    """
    Test 3: Authentication Logic
    Returns: (success, details, data_points)
    """
    results = []
    
    try:
        # 1. Test Password Hashing
        password = "test-password-123"
        hashed = generate_password_hash(password)
        
        # Verify hash is different from plain text
        h_ok = hashed != password
        results.append({"name": "Password Hashing Security", "status": h_ok, "diag": "Check werkzeug security implementation"})
        
        # 2. Test Password Verification
        v_ok = check_password_hash(hashed, password)
        results.append({"name": "Password Verification Logic", "status": v_ok, "diag": "Check hash comparison logic"})
        
        # 3. Test Negative verification
        nv_ok = not check_password_hash(hashed, "wrong-password")
        results.append({"name": "Negative Verification", "status": nv_ok, "diag": "Authentication allowing wrong passwords!"})

        success = all(r['status'] for r in results)
        details = "La lógica de hashing y verificación de contraseñas es segura." if success else "Falla en la seguridad de autenticación."
        
        data_points = {
            "Algoritmo": "scrypt" if "scrypt" in hashed else "pbkdf2",
            "Hash Length": len(hashed),
            "Detalle": results
        }

        return success, details, data_points

    except Exception as e:
        return False, f"Error en test de auth: {str(e)}", {}

if __name__ == "__main__":
    print(run_test())
