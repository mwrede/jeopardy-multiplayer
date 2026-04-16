-- Create a public storage bucket for clue images
INSERT INTO storage.buckets (id, name, public)
VALUES ('clue-images', 'clue-images', true)
ON CONFLICT (id) DO NOTHING;

-- Allow anyone to upload to clue-images (anon key)
CREATE POLICY "Anyone can upload clue images"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'clue-images');

-- Allow anyone to read clue images (public bucket)
CREATE POLICY "Anyone can read clue images"
ON storage.objects FOR SELECT
USING (bucket_id = 'clue-images');
