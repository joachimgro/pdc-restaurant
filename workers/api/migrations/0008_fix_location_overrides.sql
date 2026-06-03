-- Fix ai_location_overrides to be consistent with KNOWLEDGE_CHUNKS content
INSERT OR REPLACE INTO ai_location_overrides (location_id, extra_context) VALUES
  ('manchester', 'Manchester: BJJ (adults & kids) and MMA. Kids BJJ Mon/Wed 5pm. Adults BJJ and MMA Tue/Thu 7–8:30pm. Ages 16+ for MMA. Free on-site parking. Trial available every week.'),
  ('leeds', 'Leeds: kids BJJ Mon/Wed 4:30pm, adults BJJ Tue/Thu 7pm, Muay Thai Sat 10am. City-centre location near Leeds station. First trial free.'),
  ('bolton', 'Bolton: Muay Thai, MMA and BJJ (kids and adults). Classes at 5pm, 7:30pm and 8:30pm. Family-friendly, coach-led intro for all new members.'),
  ('stockport', 'Stockport: kids BJJ Wed/Fri 5pm, adults kickboxing Mon 7pm. Free trial includes kit loan for first session.');
