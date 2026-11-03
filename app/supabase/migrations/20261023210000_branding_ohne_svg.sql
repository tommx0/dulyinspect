-- Sicherheit: Logos im öffentlichen Bucket „branding“ nur noch als PNG, JPEG oder WebP.
-- SVG kann Skripte enthalten, die beim direkten Aufruf der Bild-Adresse ausgeführt würden.
-- Bereits hochgeladene SVG-Logos bleiben bestehen, bis der Admin ein neues Logo speichert.
update storage.buckets set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'] where id = 'branding';
