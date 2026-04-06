-- Migration: Legal Compliance
-- Adds legal documents, user consents, and parental consent support

-- 1. Create legal_documents table
CREATE TABLE IF NOT EXISTS legal_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type text NOT NULL CHECK (document_type IN ('terms_of_service', 'privacy_policy', 'liability_waiver')),
  version integer NOT NULL DEFAULT 1,
  title text NOT NULL,
  content text NOT NULL,
  effective_date date NOT NULL DEFAULT CURRENT_DATE,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_type, version)
);

-- Only one active document per type
CREATE UNIQUE INDEX idx_legal_documents_active_per_type
  ON legal_documents (document_type) WHERE is_active = true;

-- 2. Create user_consents table
CREATE TABLE IF NOT EXISTS user_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  consent_type text NOT NULL CHECK (consent_type IN ('terms_of_service', 'privacy_policy', 'liability_waiver', 'parental_consent')),
  legal_document_id uuid REFERENCES legal_documents(id),
  program_id uuid REFERENCES programs(id) ON DELETE SET NULL,
  ip_address text,
  user_agent text,
  guardian_name text,
  guardian_email text,
  consented_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX idx_user_consents_user_type ON user_consents (user_id, consent_type);
CREATE INDEX idx_user_consents_active_waiver ON user_consents (user_id, consent_type, program_id) WHERE revoked_at IS NULL;

-- 3. Add columns to users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS privacy_accepted_at timestamptz;

-- 4. Add columns to client_profiles table
ALTER TABLE client_profiles
  ADD COLUMN IF NOT EXISTS is_minor boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS guardian_name text,
  ADD COLUMN IF NOT EXISTS guardian_email text,
  ADD COLUMN IF NOT EXISTS parental_consent_at timestamptz;

-- 5. Enable RLS
ALTER TABLE legal_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_consents ENABLE ROW LEVEL SECURITY;

-- Legal documents: readable by everyone, writable by admin only
CREATE POLICY "legal_documents_select" ON legal_documents
  FOR SELECT USING (true);

CREATE POLICY "legal_documents_admin_insert" ON legal_documents
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "legal_documents_admin_update" ON legal_documents
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- User consents: users can read/insert their own, admins can read all
CREATE POLICY "user_consents_select_own" ON user_consents
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "user_consents_select_admin" ON user_consents
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "user_consents_insert_own" ON user_consents
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- 6. Seed placeholder legal documents
INSERT INTO legal_documents (document_type, version, title, content, effective_date, is_active) VALUES
(
  'terms_of_service',
  1,
  'Terms of Service',
  E'# Terms of Service\n\n**Effective Date:** [DATE]\n\n**[PLACEHOLDER - REQUIRES LEGAL REVIEW]**\n\nWelcome to DJP Athlete. By creating an account and using our services, you agree to these Terms of Service.\n\n## 1. Acceptance of Terms\n\nBy accessing or using DJP Athlete''s website, applications, and services (collectively, the "Services"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, do not use our Services.\n\n## 2. Eligibility\n\n- You must be at least 13 years of age to use our Services.\n- If you are between 13 and 17 years of age, you may only use our Services with the consent and supervision of a parent or legal guardian.\n- Your parent or guardian must review and agree to these Terms on your behalf.\n\n## 3. Account Registration\n\n- You must provide accurate, current, and complete information during registration.\n- You are responsible for maintaining the confidentiality of your account credentials.\n- You are responsible for all activities that occur under your account.\n\n## 4. Services Description\n\nDJP Athlete provides online athletic training programs, exercise programming, and coaching services. Our Services are designed for educational and training purposes.\n\n## 5. Health and Safety Disclaimer\n\n- Our Services are not a substitute for professional medical advice, diagnosis, or treatment.\n- You should consult with a qualified healthcare provider before beginning any exercise program.\n- You participate in all training programs at your own risk.\n\n## 6. User Conduct\n\nYou agree not to:\n- Use the Services for any unlawful purpose\n- Share your account credentials with others\n- Attempt to gain unauthorized access to our systems\n- Reproduce or distribute our content without permission\n\n## 7. Intellectual Property\n\nAll content, programs, exercises, and materials provided through our Services are the property of DJP Athlete and are protected by intellectual property laws.\n\n## 8. Payment and Subscriptions\n\n- Certain Services require payment. Pricing and payment terms will be presented before purchase.\n- Subscription terms, cancellation policies, and refund policies will be specified at the time of purchase.\n\n## 9. Limitation of Liability\n\nTo the maximum extent permitted by law, DJP Athlete shall not be liable for any indirect, incidental, special, consequential, or punitive damages resulting from your use of the Services.\n\n## 10. Termination\n\nWe reserve the right to suspend or terminate your account at our discretion, with or without notice, for conduct that we determine violates these Terms.\n\n## 11. Changes to Terms\n\nWe may update these Terms from time to time. We will notify you of material changes by posting the updated Terms on our website.\n\n## 12. Contact\n\nFor questions about these Terms, please contact us at [CONTACT EMAIL].\n\n---\n\n*This document is a placeholder and requires review by a qualified legal professional before use.*',
  CURRENT_DATE,
  true
),
(
  'privacy_policy',
  1,
  'Privacy Policy',
  E'# Privacy Policy\n\n**Effective Date:** [DATE]\n\n**[PLACEHOLDER - REQUIRES LEGAL REVIEW]**\n\nDJP Athlete ("we", "our", "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information.\n\n## 1. Information We Collect\n\n### Personal Information\n- Name, email address, date of birth\n- Physical information (height, weight, sport, position)\n- Health and injury information you provide\n- Training preferences and goals\n- Payment information (processed securely via Stripe)\n\n### Automatically Collected Information\n- Device and browser information\n- IP address\n- Usage data and analytics\n\n## 2. How We Use Your Information\n\nWe use your information to:\n- Provide and personalize our training services\n- Create customized exercise programs\n- Process payments and manage subscriptions\n- Communicate with you about your account and services\n- Improve our services and develop new features\n- Ensure safety and appropriate program design\n\n## 3. Information Sharing\n\nWe do not sell your personal information. We may share information with:\n- Service providers (payment processing, email delivery, analytics)\n- As required by law or legal process\n- To protect our rights or the safety of others\n\n## 4. Data for Minors\n\n- We collect date of birth to verify age eligibility.\n- For users under 18, we require parental or guardian consent.\n- We collect guardian contact information for minor users.\n- Parents/guardians may request access to or deletion of their child''s data.\n\n## 5. Data Security\n\nWe implement appropriate technical and organizational measures to protect your personal information, including encryption, secure servers, and access controls.\n\n## 6. Your Rights\n\nYou have the right to:\n- Access your personal information\n- Correct inaccurate information\n- Request deletion of your data\n- Opt out of marketing communications\n- Export your data in a portable format\n\n## 7. Cookies and Tracking\n\nWe use cookies and similar technologies to improve your experience. You can control cookie preferences through your browser settings.\n\n## 8. Data Retention\n\nWe retain your information for as long as your account is active or as needed to provide services. We will delete or anonymize your data upon request, subject to legal obligations.\n\n## 9. International Users\n\nOur services are operated from [COUNTRY]. If you access our services from another jurisdiction, your information may be transferred to and processed in [COUNTRY].\n\n## 10. Changes to This Policy\n\nWe may update this Privacy Policy from time to time. We will notify you of material changes via email or through our Services.\n\n## 11. Contact Us\n\nFor privacy-related inquiries, please contact us at [CONTACT EMAIL].\n\n---\n\n*This document is a placeholder and requires review by a qualified legal professional before use.*',
  CURRENT_DATE,
  true
),
(
  'liability_waiver',
  1,
  'Liability Waiver & Disclaimer',
  E'# Liability Waiver & Disclaimer\n\n**[PLACEHOLDER - REQUIRES LEGAL REVIEW]**\n\nPlease read this Liability Waiver and Disclaimer carefully before participating in any DJP Athlete training program.\n\n## Assumption of Risk\n\nI understand that participating in athletic training programs involves inherent risks, including but not limited to:\n- Muscle strains, sprains, and other soft tissue injuries\n- Joint injuries\n- Cardiovascular events\n- Aggravation of pre-existing conditions\n- Other physical injuries\n\nI voluntarily assume all risks associated with participation in DJP Athlete training programs.\n\n## Health Declaration\n\n- I confirm that I am physically fit and have no medical condition that would prevent my safe participation.\n- I have consulted with a healthcare professional regarding my fitness to participate, or I accept full responsibility for choosing not to do so.\n- I will immediately cease participation and seek medical attention if I experience pain, dizziness, or discomfort.\n\n## Waiver of Liability\n\nTo the maximum extent permitted by law, I waive and release DJP Athlete, its owners, employees, coaches, and affiliates from any and all claims, liabilities, demands, or causes of action arising from my participation in training programs, whether caused by negligence or otherwise.\n\n## Program Compliance\n\n- I agree to follow the prescribed training programs as designed.\n- I understand that modifying exercises without guidance may increase injury risk.\n- I will communicate any concerns or limitations to my coach promptly.\n\n## Minor Participants\n\nIf the participant is under 18 years of age:\n- A parent or legal guardian must review and accept this waiver on behalf of the minor.\n- The parent/guardian assumes all risks on behalf of the minor participant.\n- The parent/guardian agrees to supervise the minor''s participation as appropriate.\n\n## Acknowledgment\n\nBy accepting this waiver, I acknowledge that:\n- I have read and understand this document in its entirety.\n- I am voluntarily agreeing to this waiver.\n- This waiver is binding upon me, my heirs, and my representatives.\n\n---\n\n*This document is a placeholder and requires review by a qualified legal professional before use.*',
  CURRENT_DATE,
  true
);
