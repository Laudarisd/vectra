from pathlib import Path
from PIL import Image

assets = Path(__file__).resolve().parents[1] / 'docs' / 'assets'
original_image = Image.open(assets / 'logo-source.png')

# Resize the image to 128x128
resized_image = original_image.resize((128, 128))

# Save the resized image
resized_image.save(assets / 'logo-128.png', 'PNG')

print("Logo successfully resized and saved as resized_logo.png")
