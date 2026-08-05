# barcode.py — Look up a barcode in the local Open Food Facts DB (barcode source)

"""
Barcode module for looking up product data from the local Open Food Facts
database using a barcode.

Functions:
- lookup_by_barcode: Look up a product by EAN-13/UPC barcode
"""

from typing import Dict, Optional


def lookup_by_barcode(barcode: str) -> Optional[Dict]:
    """
    Look up a product in the local Open Food Facts database by barcode.
    
    Args:
        barcode: The EAN-13 or UPC barcode string
        
    Returns:
        A dictionary containing product data (name, per-100g macros, barcode)
        or None if not found.
        
    TODO: Implement Open Food Facts database lookup after data import is complete.
    """
    raise NotImplementedError("lookup_by_barcode not implemented yet")