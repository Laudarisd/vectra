from PIL import Image

# Open the original logo image
original_image = Image.open('./logo.png')

# Resize the image to 128x128
resized_image = original_image.resize((128, 128))

# Save the resized image
resized_image.save('./resized_logo.png', 'PNG')

print("Logo successfully resized and saved as resized_logo.png")