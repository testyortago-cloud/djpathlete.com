"use client"

import { Twitter, Linkedin, Instagram, Youtube } from "lucide-react"
import { motion } from "framer-motion"
import Link from "next/link"
import { FOOTER_SECTIONS } from "@/lib/constants"

type FooterLink = {
  label: string
  href: string
}

type FooterSection = {
  title: string
  links: FooterLink[]
}

type FooterProps = {
  companyName?: string
  tagline?: string
  sections?: FooterSection[]
  socialLinks?: {
    twitter?: string
    linkedin?: string
    instagram?: string
    youtube?: string
  }
  copyrightText?: string
}

const defaultSections: FooterSection[] = FOOTER_SECTIONS

export const Footer = ({
  companyName = "DJP Athlete",
  tagline = "Elite sports coaching and athletic performance training. Personalized programs built by coaches, for athletes at every level.",
  sections = defaultSections,
  socialLinks = {
    twitter: "#",
    linkedin: "#",
    instagram: "#",
    youtube: "#",
  },
  copyrightText,
}: FooterProps) => {
  const copyright = copyrightText || `\u00A9 ${new Date().getFullYear()} DJP Athlete. All rights reserved.`
  const iconClass =
    "w-9 h-9 flex items-center justify-center rounded-full bg-white border border-border text-muted-foreground hover:text-primary hover:border-primary transition-colors duration-150"

  return (
    <footer className="w-full border-t border-border bg-surface">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-8 py-12 lg:py-16">
        {/* Main Footer Content */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-8 mb-12">
          {/* Brand Column */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="col-span-2"
          >
            <div className="mb-4">
              <span className="font-heading text-xl font-semibold text-primary tracking-tight">
                {companyName}
              </span>
              <p className="text-sm leading-5 text-muted-foreground max-w-xs mt-2">
                {tagline}
              </p>
            </div>

            {/* Social Links */}
            <div className="flex items-center gap-3 mt-6">
              {socialLinks.twitter && (
                <a href={socialLinks.twitter} className={iconClass} aria-label="Twitter" target="_blank" rel="noopener noreferrer">
                  <Twitter className="w-4 h-4" />
                </a>
              )}
              {socialLinks.linkedin && (
                <a href={socialLinks.linkedin} className={iconClass} aria-label="LinkedIn" target="_blank" rel="noopener noreferrer">
                  <Linkedin className="w-4 h-4" />
                </a>
              )}
              {socialLinks.instagram && (
                <a href={socialLinks.instagram} className={iconClass} aria-label="Instagram" target="_blank" rel="noopener noreferrer">
                  <Instagram className="w-4 h-4" />
                </a>
              )}
              {socialLinks.youtube && (
                <a href={socialLinks.youtube} className={iconClass} aria-label="YouTube" target="_blank" rel="noopener noreferrer">
                  <Youtube className="w-4 h-4" />
                </a>
              )}
            </div>
          </motion.div>

          {/* Link Sections */}
          {sections.map((section, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.5, delay: index * 0.1, ease: "easeOut" }}
              className="col-span-1"
            >
              <h4 className="text-sm font-medium text-primary mb-4 uppercase tracking-wide">
                {section.title}
              </h4>
              <ul className="space-y-3">
                {section.links.map((link, linkIndex) => (
                  <li key={linkIndex}>
                    <Link
                      href={link.href}
                      className="text-sm text-muted-foreground hover:text-primary transition-colors duration-150"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>

        {/* Bottom Bar */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.6 }}
          className="pt-8 border-t border-border"
        >
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-sm text-muted-foreground">
              {copyright}
            </p>
          </div>
        </motion.div>
      </div>
    </footer>
  )
}
